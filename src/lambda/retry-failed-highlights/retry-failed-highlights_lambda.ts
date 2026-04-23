import { Handler, Context } from 'aws-lambda';
import { DataSource } from 'typeorm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  LambdaEvent,
  RetryResult,
  RetryResultItem,
  RetryError,
} from 'src/lambda/retry-failed-highlights/types/lambda.types';
import {
  formatLogMessage,
  validateEnvironmentVariables,
} from 'src/lambda/retry-failed-highlights/utils/lambda.util';
import {
  CLIP_PROCESSING,
  HIGHLIGHT_STATUS,
} from 'src/constant/constant';

/**
 * Sweep Lambda — runs every 10 minutes
 * Finds stuck/failed highlights, resets their status, collects DISTINCT recording IDs,
 * and enqueues ONE SQS message per recording (not per highlight).
 */
export const main: Handler = async (
  event: LambdaEvent,
  context: Context,
): Promise<RetryResult> => {
  console.log(
    formatLogMessage('Retry Failed Highlights (Sweep) Lambda started', {
      event,
      requestId: context.awsRequestId,
      remainingTime: context.getRemainingTimeInMillis(),
    }),
  );

  // Validate environment variables
  try {
    validateEnvironmentVariables();
    console.log('Environment variables validated successfully.');
  } catch (error) {
    console.error(
      formatLogMessage('Environment validation failed', {
        error: error.message,
      }),
    );
    return {
      success: false,
      processedCount: 0,
      retriedCount: 0,
      errorsCount: 1,
      results: [],
      errors: [{ error: error.message }],
    };
  }

  // Skip warmup events
  if (event.source === 'serverless-plugin-warmup') {
    console.log('Warmup event received, skipping processing');
    return {
      success: true,
      processedCount: 0,
      retriedCount: 0,
      errorsCount: 0,
      results: [],
      errors: [],
    };
  }

  const queueUrl = process.env.CLIP_PROCESSING_QUEUE_URL;
  if (!queueUrl) {
    console.error('CLIP_PROCESSING_QUEUE_URL not configured');
    return {
      success: false,
      processedCount: 0,
      retriedCount: 0,
      errorsCount: 1,
      results: [],
      errors: [{ error: 'CLIP_PROCESSING_QUEUE_URL not configured' }],
    };
  }

  let dataSource: DataSource;
  const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'ap-south-1' });

  try {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      entities: [],
      synchronize: false,
      logging: false,
      ssl: { rejectUnauthorized: false },
    });

    await dataSource.initialize();
    // Match EB app's IST timezone so NOW() comparisons work with stored timestamps
    await dataSource.query("SET timezone = 'Asia/Kolkata'");
    console.log('Database connection established');

    const retriedResults: RetryResultItem[] = [];
    const retryErrors: RetryError[] = [];
    let totalProcessed = 0;
    let retriedCount = 0;

    // Collect distinct recording IDs that need re-enqueue
    const recordingIdsToEnqueue = new Set<string>();

    // ──────────────────────────────────────────────────────────────────────
    // 1. Stuck 'processing' highlights (updated_at > 5 min ago → processor crashed)
    // ──────────────────────────────────────────────────────────────────────
    const stuckProcessing = await dataSource.query(`
      SELECT rh.id, rh.recording_id AS "recordingId"
      FROM recording_highlights rh
      WHERE rh.status = $1
        AND rh.updated_at < NOW() - INTERVAL '${CLIP_PROCESSING.STUCK_PROCESSING_THRESHOLD_MINUTES} minutes'
      ORDER BY rh.created_at ASC
    `, [HIGHLIGHT_STATUS.PROCESSING]);

    console.log(`Found ${stuckProcessing.length} stuck processing highlights`);

    for (const h of stuckProcessing) {
      try {
        await dataSource.query(
          `UPDATE recording_highlights SET status = $1, updated_at = NOW() WHERE id = $2`,
          [HIGHLIGHT_STATUS.QUEUED, h.id],
        );
        recordingIdsToEnqueue.add(h.recordingId);
        retriedCount++;
        retriedResults.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          success: true,
          result: 'Reset stuck processing → queued',
        });
      } catch (error) {
        retryErrors.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          error: `Failed to reset stuck processing: ${error?.message}`,
        });
      }
      totalProcessed++;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2. Pending highlights where recording is already ready (webhook missed)
    // ──────────────────────────────────────────────────────────────────────
    const missedPending = await dataSource.query(`
      SELECT rh.id, rh.recording_id AS "recordingId"
      FROM recording_highlights rh
      JOIN recordings r ON rh.recording_id = r.id
      WHERE rh.status = $1
        AND r.mux_asset_id IS NOT NULL
        AND r.status = 'ready'
      ORDER BY rh.processing_order ASC
    `, [HIGHLIGHT_STATUS.PENDING]);

    console.log(`Found ${missedPending.length} pending highlights with ready recordings`);

    for (const h of missedPending) {
      try {
        await dataSource.query(
          `UPDATE recording_highlights SET status = $1, updated_at = NOW() WHERE id = $2`,
          [HIGHLIGHT_STATUS.QUEUED, h.id],
        );
        recordingIdsToEnqueue.add(h.recordingId);
        retriedCount++;
        retriedResults.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          success: true,
          result: 'Missed pending → queued',
        });
      } catch (error) {
        retryErrors.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          error: `Failed to enqueue missed pending: ${error?.message}`,
        });
      }
      totalProcessed++;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. Stuck 'rate_limited' highlights (updated_at > 10 min ago)
    // ──────────────────────────────────────────────────────────────────────
    const stuckRateLimited = await dataSource.query(`
      SELECT rh.id, rh.recording_id AS "recordingId"
      FROM recording_highlights rh
      WHERE rh.status = $1
        AND rh.updated_at < NOW() - INTERVAL '${CLIP_PROCESSING.STUCK_RATE_LIMITED_THRESHOLD_MINUTES} minutes'
      ORDER BY rh.created_at ASC
    `, [HIGHLIGHT_STATUS.RATE_LIMITED]);

    console.log(`Found ${stuckRateLimited.length} stuck rate_limited highlights`);

    for (const h of stuckRateLimited) {
      try {
        await dataSource.query(
          `UPDATE recording_highlights SET status = $1, updated_at = NOW() WHERE id = $2`,
          [HIGHLIGHT_STATUS.QUEUED, h.id],
        );
        recordingIdsToEnqueue.add(h.recordingId);
        retriedCount++;
        retriedResults.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          success: true,
          result: 'Reset stuck rate_limited → queued',
        });
      } catch (error) {
        retryErrors.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          error: `Failed to reset stuck rate_limited: ${error?.message}`,
        });
      }
      totalProcessed++;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 4. Failed / permanently_failed — clear processing_order & re-order
    //    No retry for these. Keep the record, just remove from the chain.
    // ──────────────────────────────────────────────────────────────────────
    const failedOrPermFailed = await dataSource.query(`
      SELECT rh.id, rh.recording_id AS "recordingId", rh.status
      FROM recording_highlights rh
      WHERE rh.status IN ($1, $2)
        AND rh.processing_order IS NOT NULL
    `, [HIGHLIGHT_STATUS.FAILED, HIGHLIGHT_STATUS.PERMANENTLY_FAILED]);

    console.log(`Found ${failedOrPermFailed.length} failed/permanently_failed highlights to clear processing_order`);

    // Collect affected recording IDs for re-ordering
    const recordingsToReorder = new Set<string>();

    for (const h of failedOrPermFailed) {
      try {
        await dataSource.query(
          `UPDATE recording_highlights SET processing_order = NULL, updated_at = NOW() WHERE id = $1`,
          [h.id],
        );
        recordingsToReorder.add(h.recordingId);
        retriedResults.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          success: true,
          result: `${h.status} → cleared processing_order (no retry)`,
        });
      } catch (error) {
        retryErrors.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          error: `Failed to clear processing_order: ${error?.message}`,
        });
      }
      totalProcessed++;
    }

    // Re-order processing_order by relative_timestamp for affected recordings (close gaps)
    for (const recId of recordingsToReorder) {
      try {
        await dataSource.query(`
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
        `, [recId]);
        console.log(`Re-ordered processing_order for recording ${recId}`);
      } catch (error) {
        console.error(`Failed to re-order processing_order for recording ${recId}: ${error?.message}`);
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // 6. Webhook events cleanup (older than 7 days)
    // ──────────────────────────────────────────────────────────────────────
    try {
      const deleteResult = await dataSource.query(
        `DELETE FROM webhook_events WHERE created_at < NOW() - INTERVAL '${CLIP_PROCESSING.WEBHOOK_EVENTS_CLEANUP_DAYS} days'`,
      );
      const deletedCount = deleteResult[1] || 0;
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} old webhook events`);
      }
    } catch (error) {
      console.error(`Failed to cleanup webhook events: ${error?.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 7. Stuck 'queued' highlights (updated_at > 15 min ago → SQS message lost)
    // ──────────────────────────────────────────────────────────────────────
    const stuckQueued = await dataSource.query(`
      SELECT rh.id, rh.recording_id AS "recordingId"
      FROM recording_highlights rh
      JOIN recordings r ON rh.recording_id = r.id
      WHERE rh.status = $1
        AND rh.updated_at < NOW() - INTERVAL '15 minutes'
        AND r.mux_asset_id IS NOT NULL
      ORDER BY rh.processing_order ASC
    `, [HIGHLIGHT_STATUS.QUEUED]);

    console.log(`Found ${stuckQueued.length} stuck queued highlights`);

    for (const h of stuckQueued) {
      try {
        await dataSource.query(
          `UPDATE recording_highlights SET updated_at = NOW() WHERE id = $1`,
          [h.id],
        );
        recordingIdsToEnqueue.add(h.recordingId);
        retriedCount++;
        retriedResults.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          success: true,
          result: 'Re-enqueued stuck queued highlight',
        });
      } catch (error) {
        retryErrors.push({
          highlightId: h.id,
          recordingId: h.recordingId,
          error: `Failed to re-enqueue stuck queued: ${error?.message}`,
        });
      }
      totalProcessed++;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 8. Enqueue each DISTINCT recording ID ONCE to SQS
    // ──────────────────────────────────────────────────────────────────────
    console.log(`Enqueuing ${recordingIdsToEnqueue.size} distinct recordings to SQS`);

    for (const recordingId of recordingIdsToEnqueue) {
      try {
        await enqueueRecordingToSQS(sqsClient, queueUrl, recordingId);
      } catch (error) {
        retryErrors.push({
          recordingId,
          error: `Failed to enqueue recording ${recordingId}: ${error?.message}`,
        });
      }
    }

    const result: RetryResult = {
      success: retryErrors.length === 0,
      processedCount: totalProcessed,
      retriedCount,
      errorsCount: retryErrors.length,
      results: retriedResults,
      errors: retryErrors,
    };

    console.log('Sweep process completed', {
      processedCount: result.processedCount,
      retriedCount: result.retriedCount,
      errorsCount: result.errorsCount,
      recordingsEnqueued: recordingIdsToEnqueue.size,
      breakdown: {
        stuckProcessing: stuckProcessing.length,
        missedPending: missedPending.length,
        stuckRateLimited: stuckRateLimited.length,
        failedOrPermFailedCleared: failedOrPermFailed.length,
        recordingsReordered: recordingsToReorder.size,
        stuckQueued: stuckQueued.length,
      },
    });

    return result;
  } catch (error) {
    console.error('Error in sweep Lambda', {
      error: error?.message || String(error),
      stack: error?.stack,
    });

    return {
      success: false,
      processedCount: 0,
      retriedCount: 0,
      errorsCount: 1,
      results: [],
      errors: [{ error: error?.message || String(error) }],
    };
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
      console.log('Database connection closed');
    }
  }
};

/**
 * Enqueue a recording-level message to the SQS clip processing queue.
 * New format: one message per recording (consumer fetches all highlights from DB).
 */
async function enqueueRecordingToSQS(
  sqsClient: SQSClient,
  queueUrl: string,
  recordingId: string,
): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      recordingId,
      source: 'sweep',
      enqueuedAt: new Date().toISOString(),
    }),
  });

  const result = await sqsClient.send(command);
  console.log(`Enqueued recording ${recordingId} to SQS, messageId=${result.MessageId}`);
}
