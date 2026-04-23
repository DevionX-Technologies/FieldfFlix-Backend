import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ClipProcessingSource } from './types/clip-processing.types';

@Injectable()
export class ClipProcessingEnqueueService {
  private readonly logger = new Logger(ClipProcessingEnqueueService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;

  constructor() {
    this.sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'ap-south-1',
      useQueueUrlAsEndpoint: true,
    });
    this.queueUrl = process.env.CLIP_PROCESSING_QUEUE_URL || '';
  }

  async enqueueRecording(
    recordingId: string,
    source: ClipProcessingSource,
  ): Promise<string | undefined> {
    if (!this.queueUrl) {
      this.logger.warn(
        'CLIP_PROCESSING_QUEUE_URL not configured, skipping SQS enqueue',
      );
      return undefined;
    }

    const messageBody = JSON.stringify({
      recordingId,
      source,
      enqueuedAt: new Date().toISOString(),
    });

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: messageBody,
    });

    const result = await this.sqsClient.send(command);
    this.logger.log(
      `Enqueued recording ${recordingId} to SQS (source=${source})`,
      { messageId: result.MessageId },
    );

    return result.MessageId;
  }
}
