import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import axios from 'axios';
import {
  DURATION_TO_BACKTRACK_SECONDS,
  MUX_API_BASE_URL,
  CLIP_PROCESSING,
  HIGHLIGHT_STATUS,
  TERMINAL_STATUSES,
} from 'src/constant/constant';
import {
  RecordingProcessingResult,
  HighlightProcessingResult,
} from './types/clip-processing.types';
import {
  parseRelativeTimestampToSeconds,
  calculateRateLimitDelay,
  classifyError,
  delay,
} from './utils/clip-processing.util';

@Injectable()
export class ClipProcessingProcessor {
  private readonly logger = new Logger(ClipProcessingProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async processRecording(recordingId: string): Promise<RecordingProcessingResult> {
    const startTime = Date.now();
    const results: HighlightProcessingResult[] = [];
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    let permanentlyFailed = 0;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // 1. Acquire advisory lock
      const lockAcquired = await this.tryAcquireAdvisoryLock(queryRunner, recordingId);
      if (!lockAcquired) {
        this.logger.log(`Advisory lock not acquired for recording ${recordingId}, skipping`);
        return {
          recordingId,
          status: 'locked',
          processed: 0,
          failed: 0,
          skipped: 0,
          permanentlyFailed: 0,
          results: [],
          durationMs: Date.now() - startTime,
        };
      }

      try {
        // 2. Query all actionable highlights
        const highlights = await this.getActionableHighlights(queryRunner, recordingId);

        if (highlights.length === 0) {
          this.logger.log(`No actionable highlights for recording ${recordingId}`);
          return {
            recordingId,
            status: 'no_highlights',
            processed: 0,
            failed: 0,
            skipped: 0,
            permanentlyFailed: 0,
            results: [],
            durationMs: Date.now() - startTime,
          };
        }

        // 3. Fetch recording's mux_asset_id
        const recording = await queryRunner.query(
          `SELECT id, mux_asset_id AS "muxAssetId" FROM recordings WHERE id = $1`,
          [recordingId],
        );

        if (!recording[0]?.muxAssetId) {
          this.logger.warn(`Recording ${recordingId} has no mux_asset_id, skipping all highlights`);
          return {
            recordingId,
            status: 'failed',
            processed: 0,
            failed: 0,
            skipped: highlights.length,
            permanentlyFailed: 0,
            results: [],
            durationMs: Date.now() - startTime,
          };
        }

        const muxAssetId = recording[0].muxAssetId;

        this.logger.log(
          `Processing ${highlights.length} highlights for recording ${recordingId}`,
        );

        // 4. Process each highlight sequentially
        for (let i = 0; i < highlights.length; i++) {
          const highlight = highlights[i];
          const result = await this.processHighlight(queryRunner, highlight, muxAssetId);
          results.push(result);

          switch (result.action) {
            case 'processed':
              processed++;
              break;
            case 'failed':
              failed++;
              break;
            case 'skipped':
              skipped++;
              break;
            case 'permanently_failed':
              permanentlyFailed++;
              break;
          }

          // Sleep INTER_CLIP_DELAY between successful clips (not after the last one)
          if (result.action === 'processed' && i < highlights.length - 1) {
            await delay(CLIP_PROCESSING.INTER_CLIP_DELAY_SECONDS * 1000);
          }
        }

        const status = failed === 0 && permanentlyFailed === 0 ? 'completed' : 'partial';

        this.logger.log(
          `Recording ${recordingId} processing ${status}: ${processed} processed, ${failed} failed, ${skipped} skipped, ${permanentlyFailed} permanently failed`,
        );

        return {
          recordingId,
          status,
          processed,
          failed,
          skipped,
          permanentlyFailed,
          results,
          durationMs: Date.now() - startTime,
        };
      } finally {
        // 5. Release advisory lock
        await this.releaseAdvisoryLock(queryRunner, recordingId);
      }
    } finally {
      await queryRunner.release();
    }
  }

  private async processHighlight(
    queryRunner: QueryRunner,
    highlight: any,
    muxAssetId: string,
  ): Promise<HighlightProcessingResult> {
    const highlightId = highlight.id;

    try {
      // Skip if already in terminal state
      if (TERMINAL_STATUSES.includes(highlight.status as any)) {
        return {
          highlightId,
          success: true,
          action: 'skipped',
          message: `Already in terminal state: ${highlight.status}`,
        };
      }

      // If already has asset_id, check its status
      if (highlight.isClipCreated || highlight.assetId) {
        return await this.checkExistingClip(queryRunner, highlight);
      }

      if (!highlight.relativeTimestamp) {
        await this.markPermanentlyFailed(
          queryRunner,
          highlightId,
          'No relative timestamp available',
        );
        return {
          highlightId,
          success: false,
          action: 'permanently_failed',
          message: 'No relative timestamp',
        };
      }

      // Set status to processing with optimistic lock
      const updated = await this.setStatusProcessing(
        queryRunner,
        highlightId,
        highlight.lock_version,
      );
      if (!updated) {
        return {
          highlightId,
          success: false,
          action: 'skipped',
          message: 'Optimistic lock conflict',
        };
      }

      // Create clip in Mux with in-process rate limit retry
      const clipResult = await this.createClipWithRateLimitRetry(
        queryRunner,
        highlightId,
        muxAssetId,
        highlight.relativeTimestamp,
      );

      return clipResult;
    } catch (error) {
      return await this.handleHighlightError(queryRunner, highlightId, error);
    }
  }

  private async createClipWithRateLimitRetry(
    queryRunner: QueryRunner,
    highlightId: string,
    muxAssetId: string,
    relativeTimestamp: string,
  ): Promise<HighlightProcessingResult> {
    const highlightTimeInSeconds = parseRelativeTimestampToSeconds(relativeTimestamp);
    const endTime = highlightTimeInSeconds;
    const startTime = Math.max(0, highlightTimeInSeconds - DURATION_TO_BACKTRACK_SECONDS);

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    if (!muxTokenId || !muxTokenSecret) {
      await this.markPermanentlyFailed(
        queryRunner,
        highlightId,
        'Mux credentials not configured',
      );
      return {
        highlightId,
        success: false,
        action: 'permanently_failed',
        message: 'Mux credentials not configured',
      };
    }

    let rateLimitAttempt = 0;

    while (rateLimitAttempt <= CLIP_PROCESSING.MAX_RATE_LIMIT_RETRIES) {
      try {
        this.logger.log(
          `Creating Mux clip for highlight ${highlightId}: ${startTime}s - ${endTime}s` +
          (rateLimitAttempt > 0 ? ` (rate limit retry ${rateLimitAttempt})` : ''),
        );

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
            // Match the source asset's policy: when signed playback is configured we mint
            // signed clips so they only play through the app via a backend-issued JWT.
            playback_policy: [
              process.env.MUX_SIGNING_KEY_ID ? 'signed' : 'public',
            ],
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
          [HIGHLIGHT_STATUS.CLIP_CREATED, clipAssetId, playbackId, muxAssetId, highlightId],
        );

        this.logger.log(`Clip created: asset=${clipAssetId}, highlight=${highlightId}`);

        return {
          highlightId,
          success: true,
          action: 'processed',
          message: `Clip created: Mux Asset ID ${clipAssetId}`,
        };
      } catch (error) {
        const errorInfo = classifyError(error);

        if (errorInfo.type === 'rate_limit') {
          rateLimitAttempt++;
          if (rateLimitAttempt > CLIP_PROCESSING.MAX_RATE_LIMIT_RETRIES) {
            await this.markFailed(
              queryRunner,
              highlightId,
              `Rate limit retries exhausted (${rateLimitAttempt})`,
            );
            return {
              highlightId,
              success: false,
              action: 'failed',
              message: 'Rate limit retries exhausted',
            };
          }

          const sleepMs = calculateRateLimitDelay(
            rateLimitAttempt,
            errorInfo.retryAfter || null,
            CLIP_PROCESSING.RATE_LIMIT_BASE_DELAY_SECONDS,
            CLIP_PROCESSING.RATE_LIMIT_DELAY_CAP_SECONDS,
          ) * 1000;

          this.logger.warn(
            `Rate limited on highlight ${highlightId}, sleeping ${sleepMs / 1000}s (attempt ${rateLimitAttempt}/${CLIP_PROCESSING.MAX_RATE_LIMIT_RETRIES})`,
          );
          await delay(sleepMs);
          continue;
        }

        // Non-rate-limit errors: re-throw to be handled by caller
        throw error;
      }
    }

    // Should not reach here, but just in case
    return {
      highlightId,
      success: false,
      action: 'failed',
      message: 'Rate limit retry loop exhausted unexpectedly',
    };
  }

  private async handleHighlightError(
    queryRunner: QueryRunner,
    highlightId: string,
    error: any,
  ): Promise<HighlightProcessingResult> {
    const errorInfo = classifyError(error);
    const errorMessage = error?.response?.data?.error?.message || error?.message || 'Unknown error';

    this.logger.error(
      `Error processing highlight ${highlightId}: ${errorMessage}`,
      { errorType: errorInfo.type, httpStatus: errorInfo.httpStatus },
    );

    switch (errorInfo.type) {
      case 'bad_input':
        await this.markPermanentlyFailed(
          queryRunner,
          highlightId,
          `Bad input (400): ${errorMessage}`,
        );
        return {
          highlightId,
          success: false,
          action: 'permanently_failed',
          message: `Permanently failed: bad input (400)`,
        };

      case 'auth_error':
        await this.markPermanentlyFailed(
          queryRunner,
          highlightId,
          `Auth error (${errorInfo.httpStatus}): ${errorMessage}`,
        );
        this.logger.error(`AUTH ERROR — check Mux credentials. Stopping recording processing.`);
        // Throw to stop processing all remaining highlights (they'll all fail with same auth issue)
        throw new Error(`Auth error (${errorInfo.httpStatus}): stopping recording processing`);

      case 'server_error':
      case 'network_error':
      default:
        await this.markFailed(queryRunner, highlightId, errorMessage);
        return {
          highlightId,
          success: false,
          action: 'failed',
          message: `Failed (${errorInfo.type}): ${errorMessage}`,
        };
    }
  }

  private async checkExistingClip(
    queryRunner: QueryRunner,
    highlight: any,
  ): Promise<HighlightProcessingResult> {
    const highlightId = highlight.id;
    const assetId = highlight.assetId;

    if (!assetId) {
      return {
        highlightId,
        success: false,
        action: 'skipped',
        message: 'No asset ID to check',
      };
    }

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    try {
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
          highlightId,
          success: true,
          action: 'processed',
          message: `Clip already ready: ${playbackUrl}`,
        };
      }

      return {
        highlightId,
        success: true,
        action: 'skipped',
        message: `Existing clip in status: ${asset.status}`,
      };
    } catch (error) {
      if (error?.response?.status === 404) {
        // Asset not found in Mux, reset for recreation
        await queryRunner.query(
          `UPDATE recording_highlights
           SET status = $1,
               asset_id = NULL,
               playback_id = NULL,
               mux_public_playback_url = NULL,
               "isClipCreated" = false,
               failed_message = 'Mux asset not found (404), needs recreation',
               lock_version = lock_version + 1,
               updated_at = NOW()
           WHERE id = $2`,
          [HIGHLIGHT_STATUS.FAILED, highlightId],
        );
        return {
          highlightId,
          success: false,
          action: 'failed',
          message: 'Asset not found in Mux (404), reset for recreation',
        };
      }
      throw error;
    }
  }

  private async getActionableHighlights(
    queryRunner: QueryRunner,
    recordingId: string,
  ): Promise<any[]> {
    return queryRunner.query(
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
        rh.processing_order AS "processingOrder"
      FROM recording_highlights rh
      WHERE rh.recording_id = $1
        AND rh.status NOT IN ($2, $3, $4, $5)
      ORDER BY rh.processing_order ASC`,
      [
        recordingId,
        HIGHLIGHT_STATUS.CLIP_CREATED,
        HIGHLIGHT_STATUS.READY,
        HIGHLIGHT_STATUS.PERMANENTLY_FAILED,
        HIGHLIGHT_STATUS.FAILED,
      ],
    );
  }

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
      this.logger.warn(
        `Failed to release advisory lock for recording ${recordingId}: ${error?.message}`,
      );
    }
  }

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
    return result[1] > 0;
  }

  private async markPermanentlyFailed(
    queryRunner: QueryRunner,
    highlightId: string,
    reason: string,
  ): Promise<void> {
    // Get recording_id before clearing processing_order
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

    this.logger.log(`Highlight ${highlightId} permanently failed (re-ordered): ${reason}`);
  }

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
      this.logger.warn(`Failed to re-order processing_order for recording ${recordingId}: ${error?.message}`);
    }
  }

  private async markFailed(
    queryRunner: QueryRunner,
    highlightId: string,
    reason: string,
  ): Promise<void> {
    // Get recording_id before clearing processing_order
    const hlRow = await queryRunner.query(
      `SELECT recording_id FROM recording_highlights WHERE id = $1`,
      [highlightId],
    );
    const recordingId = hlRow[0]?.recording_id;

    await queryRunner.query(
      `UPDATE recording_highlights
       SET status = $1,
           "retryCount" = "retryCount" + 1,
           failed_message = $2,
           processing_order = NULL,
           lock_version = lock_version + 1,
           updated_at = NOW()
       WHERE id = $3`,
      [HIGHLIGHT_STATUS.FAILED, reason, highlightId],
    );

    // Re-order remaining highlights to close gaps
    if (recordingId) {
      await this.reorderProcessingOrder(queryRunner, recordingId);
    }

    this.logger.log(`Highlight ${highlightId} marked failed (processing_order cleared, re-ordered): ${reason}`);
  }
}
