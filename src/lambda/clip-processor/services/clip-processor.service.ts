import { DataSource, QueryRunner } from 'typeorm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import axios from 'axios';
import {
  DURATION_TO_BACKTRACK_SECONDS,
  MUX_API_BASE_URL,
  CLIP_PROCESSING,
  HIGHLIGHT_STATUS,
  TERMINAL_STATUSES,
  NON_BLOCKING_STATUSES,
} from 'src/constant/constant';
import {
  ClipProcessorMessage,
  ClipProcessorResult,
} from '../types/clip-processor.types';
import {
  parseRelativeTimestampToSeconds,
  calculateRateLimitDelay,
  classifyError,
} from '../utils/clip-processor.util';

export class ClipProcessorService {
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;

  constructor(
    private readonly dataSource: DataSource,
  ) {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'ap-south-1',
    });
    this.queueUrl = process.env.CLIP_PROCESSING_QUEUE_URL;
  }

  /**
   * Main entry point for processing a clip message from SQS
   */
  async processMessage(message: ClipProcessorMessage): Promise<ClipProcessorResult> {
    const { recordingId, highlightId, processingOrder } = message;

    console.log(`Processing clip: highlight=${highlightId}, recording=${recordingId}, order=${processingOrder}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // 1. Check if there are earlier unfinished highlights for this recording
      const hasPredecessors = await this.hasPendingPredecessors(
        queryRunner,
        recordingId,
        processingOrder,
      );

      if (hasPredecessors) {
        console.log(`Highlight ${highlightId} has pending predecessors, re-queuing`);
        await this.requeue(message, CLIP_PROCESSING.NOT_MY_TURN_DELAY_SECONDS);
        return {
          success: true,
          highlightId,
          recordingId,
          message: 'Re-queued: waiting for earlier highlights to complete',
          action: 'requeued',
        };
      }

      // 2. Try to acquire PostgreSQL advisory lock for this recording
      const lockAcquired = await this.tryAcquireAdvisoryLock(queryRunner, recordingId);
      if (!lockAcquired) {
        console.log(`Advisory lock not acquired for recording ${recordingId}, re-queuing`);
        await this.requeue(message, CLIP_PROCESSING.ADVISORY_LOCK_DELAY_SECONDS);
        return {
          success: true,
          highlightId,
          recordingId,
          message: 'Re-queued: another clip for this recording is being processed',
          action: 'requeued',
        };
      }

      // Lock acquired — start a transaction
      await queryRunner.startTransaction();

      try {
        // 3. Fetch and validate the highlight
        const highlight = await this.getHighlight(queryRunner, highlightId);
        if (!highlight) {
          console.log(`Highlight ${highlightId} not found, skipping`);
          await queryRunner.commitTransaction();
          return {
            success: false,
            highlightId,
            recordingId,
            message: 'Highlight not found',
            action: 'skipped',
          };
        }

        // Skip if already in a terminal state
        if (TERMINAL_STATUSES.includes(highlight.status as any)) {
          console.log(`Highlight ${highlightId} already in terminal state: ${highlight.status}`);
          await queryRunner.commitTransaction();
          return {
            success: true,
            highlightId,
            recordingId,
            message: `Already in terminal state: ${highlight.status}`,
            action: 'skipped',
          };
        }

        // 4. Update status to processing with optimistic lock
        const updated = await this.setStatusProcessing(queryRunner, highlightId, highlight.lock_version);
        if (!updated) {
          console.log(`Optimistic lock failed for highlight ${highlightId}, skipping`);
          await queryRunner.commitTransaction();
          return {
            success: false,
            highlightId,
            recordingId,
            message: 'Optimistic lock conflict, skipping',
            action: 'skipped',
          };
        }

        // 5. Create the clip in Mux
        const result = await this.createClipInMux(queryRunner, highlight);
        await queryRunner.commitTransaction();

        // 6. ALWAYS enqueue next highlight — don't let failures block the chain.
        // Failed highlights are retried later by the sweep Lambda.
        await this.enqueueNextHighlight(recordingId, processingOrder);

        return result;
      } catch (error) {
        if (queryRunner.isTransactionActive) {
          await queryRunner.rollbackTransaction();
        }
        throw error;
      } finally {
        // Release advisory lock
        await this.releaseAdvisoryLock(queryRunner, recordingId);
      }
    } catch (error) {
      console.error(`Error processing highlight ${highlightId}:`, error?.message || error);

      // Handle the error based on classification
      const errorResult = await this.handleProcessingError(error, message, queryRunner);

      // ALWAYS enqueue next highlight even on failure — don't block the chain.
      // The failed one will be retried later by the sweep Lambda.
      try {
        await this.enqueueNextHighlight(recordingId, processingOrder);
      } catch (enqueueError) {
        console.warn(`Failed to enqueue next highlight after error for ${highlightId}:`, enqueueError?.message);
      }

      return errorResult;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Check if there are earlier highlights that are still actively being processed.
   * Failed/rate_limited highlights do NOT block — the chain skips them and continues.
   * The sweep Lambda will retry failed ones later.
   */
  private async hasPendingPredecessors(
    queryRunner: QueryRunner,
    recordingId: string,
    currentOrder: number,
  ): Promise<boolean> {
    const result = await queryRunner.query(
      `SELECT COUNT(*) as count
       FROM recording_highlights
       WHERE recording_id = $1
         AND processing_order < $2
         AND status NOT IN ($3, $4, $5, $6, $7)`,
      [
        recordingId,
        currentOrder,
        HIGHLIGHT_STATUS.CLIP_CREATED,
        HIGHLIGHT_STATUS.READY,
        HIGHLIGHT_STATUS.PERMANENTLY_FAILED,
        HIGHLIGHT_STATUS.FAILED,
        HIGHLIGHT_STATUS.RATE_LIMITED,
      ],
    );
    return parseInt(result[0].count, 10) > 0;
  }

  /**
   * Try to acquire a PostgreSQL advisory lock using a hash of the recording ID
   */
  private async tryAcquireAdvisoryLock(
    queryRunner: QueryRunner,
    recordingId: string,
  ): Promise<boolean> {
    const result = await queryRunner.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) as acquired`,
      [recordingId],
    );
    return result[0].acquired === true;
  }

  /**
   * Release the advisory lock
   */
  private async releaseAdvisoryLock(
    queryRunner: QueryRunner,
    recordingId: string,
  ): Promise<void> {
    try {
      await queryRunner.query(
        `SELECT pg_advisory_unlock(hashtext($1))`,
        [recordingId],
      );
    } catch (error) {
      console.warn(`Failed to release advisory lock for recording ${recordingId}:`, error?.message);
    }
  }

  /**
   * Get a highlight with its associated recording data
   */
  private async getHighlight(queryRunner: QueryRunner, highlightId: string): Promise<any> {
    const result = await queryRunner.query(
      `SELECT
        rh.id,
        rh.recording_id AS "recordingId",
        rh.relative_timestamp AS "relativeTimestamp",
        rh.source_asset_id AS "sourceAssetId",
        rh.asset_id AS "assetId",
        rh.status,
        rh.failed_message AS "failedMessage",
        rh.playback_id AS "playbackId",
        rh."isClipCreated",
        rh."retryCount",
        rh.rate_limit_retry_count AS "rateLimitRetryCount",
        rh.lock_version,
        rh.metadata,
        rh.processing_order AS "processingOrder",
        r."startTime",
        r."endTime",
        r.mux_asset_id AS "muxAssetId"
      FROM recording_highlights rh
      LEFT JOIN recordings r ON rh.recording_id = r.id
      WHERE rh.id = $1`,
      [highlightId],
    );
    return result[0] || null;
  }

  /**
   * Set highlight status to 'processing' with optimistic lock check
   */
  private async setStatusProcessing(
    queryRunner: QueryRunner,
    highlightId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await queryRunner.query(
      `UPDATE recording_highlights
       SET status = $1, lock_version = lock_version + 1, updated_at = NOW()
       WHERE id = $2 AND lock_version = $3`,
      [HIGHLIGHT_STATUS.PROCESSING, highlightId, expectedVersion],
    );
    return result[1] > 0; // rowCount > 0
  }

  /**
   * Create a clip in Mux and update the highlight accordingly
   */
  private async createClipInMux(
    queryRunner: QueryRunner,
    highlight: any,
  ): Promise<ClipProcessorResult> {
    const { id: highlightId, recordingId, muxAssetId, relativeTimestamp } = highlight;

    // If already has asset_id, check its status instead
    if (highlight.isClipCreated || highlight.assetId) {
      return await this.checkExistingClip(queryRunner, highlight);
    }

    if (!muxAssetId) {
      console.error(`Recording for highlight ${highlightId} has no Mux asset ID`);
      await this.markPermanentlyFailed(
        queryRunner,
        highlightId,
        'Recording does not have a Mux asset ID',
      );
      return {
        success: false,
        highlightId,
        recordingId,
        message: 'Recording has no Mux asset ID',
        action: 'failed',
      };
    }

    if (!relativeTimestamp) {
      console.error(`Highlight ${highlightId} has no relative timestamp`);
      await this.markPermanentlyFailed(
        queryRunner,
        highlightId,
        'No relative timestamp available',
      );
      return {
        success: false,
        highlightId,
        recordingId,
        message: 'No relative timestamp',
        action: 'failed',
      };
    }

    const highlightTimeInSeconds = parseRelativeTimestampToSeconds(relativeTimestamp);
    const endTime = highlightTimeInSeconds;
    const startTime = Math.max(0, highlightTimeInSeconds - DURATION_TO_BACKTRACK_SECONDS);

    console.log(`Creating Mux clip for highlight ${highlightId}: ${startTime}s - ${endTime}s`);

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    const response = await axios({
      method: 'POST',
      url: `${MUX_API_BASE_URL}/video/v1/assets`,
      headers: { 'Content-Type': 'application/json' },
      auth: { username: muxTokenId, password: muxTokenSecret },
      data: {
        input: [{
          url: `mux://assets/${muxAssetId}`,
          start_time: startTime,
          end_time: endTime,
        }],
        playback_policy: ['public'],
        video_quality: 'basic',
      },
    });

    if (response.status !== 201) {
      throw new Error(`Mux API returned status ${response.status}`);
    }

    const clipAssetId = response.data.data.id;
    const playbackId = Array.isArray(response.data.data.playback_ids)
      ? response.data.data.playback_ids.find((p: any) => p?.policy === 'public')?.id
      : null;

    // Update highlight to clip_created
    await queryRunner.query(
      `UPDATE recording_highlights
       SET status = $1,
           asset_id = $2,
           playback_id = $3,
           source_asset_id = $4,
           "isClipCreated" = true,
           "retryCount" = 0,
           rate_limit_retry_count = 0,
           lock_version = lock_version + 1,
           updated_at = NOW()
       WHERE id = $5`,
      [
        HIGHLIGHT_STATUS.CLIP_CREATED,
        clipAssetId,
        playbackId,
        muxAssetId,
        highlightId,
      ],
    );

    console.log(`Clip created successfully: asset=${clipAssetId}, highlight=${highlightId}`);

    return {
      success: true,
      highlightId,
      recordingId,
      message: `Clip created: Mux Asset ID ${clipAssetId}`,
      action: 'processed',
    };
  }

  /**
   * Check status of an existing Mux clip asset
   */
  private async checkExistingClip(
    queryRunner: QueryRunner,
    highlight: any,
  ): Promise<ClipProcessorResult> {
    const { id: highlightId, recordingId, assetId } = highlight;

    if (!assetId) {
      return {
        success: false,
        highlightId,
        recordingId,
        message: 'No asset ID to check',
        action: 'skipped',
      };
    }

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    const response = await axios({
      method: 'GET',
      url: `${MUX_API_BASE_URL}/video/v1/assets/${assetId}`,
      headers: { 'Content-Type': 'application/json' },
      auth: { username: muxTokenId, password: muxTokenSecret },
    });

    const asset = response.data.data;
    const playbackId = Array.isArray(asset.playback_ids)
      ? asset.playback_ids.find((p: any) => p?.policy === 'public')?.id
      : null;

    if (asset.status === 'ready') {
      const playbackUrl = playbackId
        ? `https://stream.mux.com/${playbackId}.m3u8`
        : null;

      await queryRunner.query(
        `UPDATE recording_highlights
         SET status = $1,
             playback_id = $2,
             mux_public_playback_url = $3,
             "isClipCreated" = true,
             lock_version = lock_version + 1,
             updated_at = NOW()
         WHERE id = $4`,
        [HIGHLIGHT_STATUS.READY, playbackId, playbackUrl, highlightId],
      );

      return {
        success: true,
        highlightId,
        recordingId,
        message: `Clip already ready: ${playbackUrl}`,
        action: 'processed',
      };
    }

    // If clip_created status, just leave it — webhook will handle ready
    return {
      success: true,
      highlightId,
      recordingId,
      message: `Existing clip in status: ${asset.status}`,
      action: 'skipped',
    };
  }

  /**
   * Handle processing errors with differentiated retry strategies
   */
  private async handleProcessingError(
    error: any,
    message: ClipProcessorMessage,
    queryRunner: QueryRunner,
  ): Promise<ClipProcessorResult> {
    const { highlightId, recordingId } = message;
    const errorInfo = classifyError(error);

    console.log(`Error classified as ${errorInfo.type} for highlight ${highlightId}`, {
      httpStatus: errorInfo.httpStatus,
      retryAfter: errorInfo.retryAfter,
    });

    // Fetch current highlight state
    let highlight: any;
    try {
      highlight = await this.getHighlight(queryRunner, highlightId);
    } catch (e) {
      console.error(`Failed to fetch highlight ${highlightId} for error handling:`, e?.message);
      return {
        success: false,
        highlightId,
        recordingId,
        message: `Processing error: ${error?.message || error}`,
        action: 'failed',
      };
    }

    if (!highlight) {
      return {
        success: false,
        highlightId,
        recordingId,
        message: 'Highlight not found during error handling',
        action: 'failed',
      };
    }

    const retryHistory = highlight.metadata?.retryHistory || [];

    switch (errorInfo.type) {
      case 'rate_limit': {
        const rateLimitCount = (highlight.rateLimitRetryCount || 0) + 1;

        if (rateLimitCount > CLIP_PROCESSING.MAX_RATE_LIMIT_RETRIES) {
          await this.markPermanentlyFailed(
            queryRunner,
            highlightId,
            `Rate limit retries exhausted (${rateLimitCount}/${CLIP_PROCESSING.MAX_RATE_LIMIT_RETRIES})`,
          );
          return {
            success: false,
            highlightId,
            recordingId,
            message: 'Permanently failed: rate limit retries exhausted',
            action: 'failed',
          };
        }

        const delay = calculateRateLimitDelay(
          rateLimitCount,
          errorInfo.retryAfter || null,
          CLIP_PROCESSING.RATE_LIMIT_BASE_DELAY_SECONDS,
          CLIP_PROCESSING.RATE_LIMIT_DELAY_CAP_SECONDS,
        );

        // Update status to rate_limited (don't increment error retryCount)
        await queryRunner.query(
          `UPDATE recording_highlights
           SET status = $1,
               rate_limit_retry_count = $2,
               metadata = $3,
               lock_version = lock_version + 1,
               updated_at = NOW()
           WHERE id = $4`,
          [
            HIGHLIGHT_STATUS.RATE_LIMITED,
            rateLimitCount,
            JSON.stringify({
              ...highlight.metadata,
              rateLimitRetryCount: rateLimitCount,
              retryHistory: [
                ...retryHistory,
                {
                  attempt: retryHistory.length + 1,
                  timestamp: new Date().toISOString(),
                  errorType: 'rate_limit',
                  httpStatus: 429,
                  errorMessage: error?.message || 'Rate limited',
                  delayApplied: delay,
                },
              ],
            }),
            highlightId,
          ],
        );

        await this.requeue(message, delay);

        return {
          success: true,
          highlightId,
          recordingId,
          message: `Rate limited, re-queued with ${delay}s delay (attempt ${rateLimitCount})`,
          action: 'requeued',
        };
      }

      case 'bad_input': {
        await this.markPermanentlyFailed(
          queryRunner,
          highlightId,
          `Bad input (400): ${error?.response?.data?.error?.message || error?.message}`,
        );
        return {
          success: false,
          highlightId,
          recordingId,
          message: 'Permanently failed: bad input (400)',
          action: 'failed',
        };
      }

      case 'auth_error': {
        await this.markPermanentlyFailed(
          queryRunner,
          highlightId,
          `Auth error (${errorInfo.httpStatus}): ${error?.message}`,
        );
        console.error(`AUTH ERROR for highlight ${highlightId} — check Mux credentials`);
        return {
          success: false,
          highlightId,
          recordingId,
          message: `Permanently failed: auth error (${errorInfo.httpStatus})`,
          action: 'failed',
        };
      }

      case 'server_error':
      case 'network_error':
      default: {
        // Don't retry non-rate-limit errors. Set processing_order = NULL and mark as failed.
        const failedMessage = error?.response?.data?.error?.message || error?.message || 'Unknown error';

        await queryRunner.query(
          `UPDATE recording_highlights
           SET status = $1,
               failed_message = $2,
               processing_order = NULL,
               metadata = $3,
               lock_version = lock_version + 1,
               updated_at = NOW()
           WHERE id = $4`,
          [
            HIGHLIGHT_STATUS.FAILED,
            failedMessage,
            JSON.stringify({
              ...highlight.metadata,
              retryHistory: [
                ...retryHistory,
                {
                  attempt: retryHistory.length + 1,
                  timestamp: new Date().toISOString(),
                  errorType: errorInfo.type,
                  httpStatus: errorInfo.httpStatus,
                  errorMessage: failedMessage,
                },
              ],
            }),
            highlightId,
          ],
        );

        console.log(`Highlight ${highlightId} marked as failed, processing_order set to NULL`);

        // Re-order remaining highlights to close gaps
        await this.reorderProcessingOrder(queryRunner, recordingId);

        return {
          success: false,
          highlightId,
          recordingId,
          message: `Failed: ${failedMessage}. No retry — processing_order cleared & re-ordered.`,
          action: 'failed',
        };
      }
    }
  }

  /**
   * Mark a highlight as permanently failed
   */
  private async markPermanentlyFailed(
    queryRunner: QueryRunner,
    highlightId: string,
    reason: string,
  ): Promise<void> {
    // Get recording_id for re-ordering
    const hlRow = await queryRunner.query(
      `SELECT recording_id FROM recording_highlights WHERE id = $1`,
      [highlightId],
    );
    const recordingId = hlRow[0]?.recording_id;

    await queryRunner.query(
      `UPDATE recording_highlights
       SET status = $1,
           failed_message = $2,
           processing_order = NULL,
           metadata = jsonb_set(
             COALESCE(metadata, '{}'),
             '{permanentlyFailed}', 'true'
           ) || jsonb_build_object(
             'permanentlyFailedAt', to_jsonb(NOW()::text),
             'permanentlyFailedReason', to_jsonb($4::text)
           ),
           lock_version = lock_version + 1,
           updated_at = NOW()
       WHERE id = $3`,
      [HIGHLIGHT_STATUS.PERMANENTLY_FAILED, reason, highlightId, reason],
    );

    // Re-order remaining highlights to close gaps
    if (recordingId) {
      await this.reorderProcessingOrder(queryRunner, recordingId);
    }

    console.log(`Highlight ${highlightId} permanently_failed, processing_order cleared & re-ordered: ${reason}`);
  }

  /**
   * Re-order processing_order for a recording to close gaps after a highlight is removed
   */
  private async reorderProcessingOrder(
    queryRunner: QueryRunner,
    recordingId: string,
  ): Promise<void> {
    try {
      await queryRunner.query(`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (
            ORDER BY
              CASE
                WHEN array_length(string_to_array(relative_timestamp, ':'), 1) = 3 THEN
                  (split_part(relative_timestamp, ':', 1)::int * 3600) +
                  (split_part(relative_timestamp, ':', 2)::int * 60) +
                  (split_part(relative_timestamp, ':', 3)::int)
                WHEN array_length(string_to_array(relative_timestamp, ':'), 1) = 2 THEN
                  (split_part(relative_timestamp, ':', 1)::int * 60) +
                  (split_part(relative_timestamp, ':', 2)::int)
                ELSE 0
              END ASC,
              created_at ASC
          ) AS new_order
          FROM recording_highlights
          WHERE recording_id = $1
            AND processing_order IS NOT NULL
        )
        UPDATE recording_highlights rh
        SET processing_order = o.new_order, updated_at = NOW()
        FROM ordered o
        WHERE rh.id = o.id
          AND rh.processing_order != o.new_order
      `, [recordingId]);
    } catch (error) {
      console.warn(`Failed to re-order processing_order for recording ${recordingId}: ${error?.message}`);
    }
  }

  /**
   * Re-enqueue the message to SQS with a delay
   */
  private async requeue(
    message: ClipProcessorMessage,
    delaySeconds: number,
  ): Promise<void> {
    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify({
        ...message,
        requeuedAt: new Date().toISOString(),
      }),
      DelaySeconds: Math.min(Math.max(0, Math.floor(delaySeconds)), 900),
    });

    const result = await this.sqsClient.send(command);
    console.log(`Re-queued highlight ${message.highlightId} with ${delaySeconds}s delay, messageId=${result.MessageId}`);
  }

  /**
   * After successful clip creation, enqueue the next highlight for this recording
   */
  private async enqueueNextHighlight(
    recordingId: string,
    currentOrder: number,
  ): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      const result = await queryRunner.query(
        `SELECT id, processing_order
         FROM recording_highlights
         WHERE recording_id = $1
           AND processing_order > $2
           AND status = $3
         ORDER BY processing_order ASC
         LIMIT 1`,
        [
          recordingId,
          currentOrder,
          HIGHLIGHT_STATUS.QUEUED,
        ],
      );

      if (result.length > 0) {
        const next = result[0];
        console.log(`Enqueuing next highlight ${next.id} (order ${next.processing_order})`);

        const command = new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({
            recordingId,
            highlightId: next.id,
            processingOrder: next.processing_order,
            enqueuedAt: new Date().toISOString(),
          }),
          DelaySeconds: CLIP_PROCESSING.INTER_CLIP_DELAY_SECONDS,
        });

        await this.sqsClient.send(command);
      } else {
        console.log(`No more highlights to process for recording ${recordingId}`);
      }
    } finally {
      await queryRunner.release();
    }
  }
}
