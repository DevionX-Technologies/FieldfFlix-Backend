import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { ClipProcessingProcessor } from './clip-processing.processor';
import { ClipProcessingMessage } from './types/clip-processing.types';
import {
  SQS_POLL_WAIT_TIME_SECONDS,
  SQS_MAX_MESSAGES,
  VISIBILITY_HEARTBEAT_INTERVAL_MS,
  VISIBILITY_EXTENSION_SECONDS,
  SQS_CONSUMER_CONCURRENCY,
} from 'src/constant/constant';

@Injectable()
export class ClipProcessingConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClipProcessingConsumer.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private running = false;
  /** Number of polling loops currently processing a message */
  private activeCount = 0;

  constructor(private readonly processor: ClipProcessingProcessor) {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'ap-south-1',
      useQueueUrlAsEndpoint: true,
    });
    this.queueUrl = process.env.CLIP_PROCESSING_QUEUE_URL || '';
  }

  onModuleInit() {
    if (!this.queueUrl) {
      this.logger.warn(
        'CLIP_PROCESSING_QUEUE_URL not configured, SQS consumer will not start',
      );
      return;
    }

    this.running = true;
    const concurrency = SQS_CONSUMER_CONCURRENCY;
    this.logger.log(
      `Starting ${concurrency} concurrent SQS polling loops`,
    );

    for (let i = 0; i < concurrency; i++) {
      this.pollLoop(i).catch((err) => {
        this.logger.error(
          `Poll loop #${i} crashed: ${err?.message}`,
          err?.stack,
        );
      });
    }
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down SQS consumer...');
    this.running = false;

    // Wait for all active processing to finish (up to 30s)
    const deadline = Date.now() + 30_000;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (this.activeCount > 0) {
      this.logger.warn(
        `Shutdown timeout reached with ${this.activeCount} loops still processing`,
      );
    }

    this.logger.log('SQS consumer shut down');
  }

  private async pollLoop(loopIndex: number): Promise<void> {
    while (this.running) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            WaitTimeSeconds: SQS_POLL_WAIT_TIME_SECONDS,
            MaxNumberOfMessages: SQS_MAX_MESSAGES,
          }),
        );

        const messages = response.Messages;
        if (!messages || messages.length === 0) {
          continue;
        }

        for (const sqsMessage of messages) {
          if (!this.running) break;

          this.activeCount++;
          let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

          try {
            // Parse message with backward compatibility
            const raw = JSON.parse(sqsMessage.Body);
            const message: ClipProcessingMessage = {
              recordingId: raw.recordingId,
              source: raw.source || (raw.highlightId ? 'legacy' : 'unknown'),
              enqueuedAt: raw.enqueuedAt || new Date().toISOString(),
            };

            this.logger.log(
              `[loop#${loopIndex}] Received SQS message for recording ${message.recordingId} (source=${message.source})`,
              { messageId: sqsMessage.MessageId },
            );

            // Start visibility timeout heartbeat
            heartbeatInterval = setInterval(async () => {
              try {
                await this.sqsClient.send(
                  new ChangeMessageVisibilityCommand({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: sqsMessage.ReceiptHandle,
                    VisibilityTimeout: VISIBILITY_EXTENSION_SECONDS,
                  }),
                );
              } catch (err) {
                this.logger.warn(
                  `[loop#${loopIndex}] Failed to extend visibility timeout: ${err?.message}`,
                );
              }
            }, VISIBILITY_HEARTBEAT_INTERVAL_MS);

            // Process all highlights for this recording
            const result = await this.processor.processRecording(
              message.recordingId,
            );

            this.logger.log(
              `[loop#${loopIndex}] Recording ${message.recordingId} processing complete: ` +
              `status=${result.status}, processed=${result.processed}, ` +
              `failed=${result.failed}, skipped=${result.skipped}, ` +
              `duration=${result.durationMs}ms`,
            );

            // Delete message on success (any non-thrown result)
            await this.sqsClient.send(
              new DeleteMessageCommand({
                QueueUrl: this.queueUrl,
                ReceiptHandle: sqsMessage.ReceiptHandle,
              }),
            );
          } catch (error) {
            this.logger.error(
              `[loop#${loopIndex}] Failed to process SQS message ${sqsMessage.MessageId}: ${error?.message}`,
              error?.stack,
            );
            // Let visibility timeout expire — SQS will retry
          } finally {
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
            }
            this.activeCount--;
          }
        }
      } catch (error) {
        this.logger.error(
          `[loop#${loopIndex}] SQS polling error: ${error?.message}`,
          error?.stack,
        );
        // Wait a bit before retrying to avoid tight error loop
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}
