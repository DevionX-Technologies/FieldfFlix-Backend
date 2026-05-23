import { Handler, SQSEvent, Context } from 'aws-lambda';
import { DataSource } from 'typeorm';
import { ClipProcessorService } from './services/clip-processor.service';
import { ClipProcessorMessage } from './types/clip-processor.types';
import { validateEnvironmentVariables } from './utils/clip-processor.util';

export const main: Handler = async (
  event: SQSEvent,
  context: Context,
): Promise<void> => {
  console.log('ClipProcessor Lambda invoked', {
    requestId: context.awsRequestId,
    remainingTime: context.getRemainingTimeInMillis(),
    recordCount: event.Records?.length || 0,
  });

  // Validate environment variables
  try {
    validateEnvironmentVariables();
  } catch (error) {
    console.error('Environment validation failed:', error.message);
    throw error; // Let SQS retry
  }

  let dataSource: DataSource;

  try {
    // Initialize database connection
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

    const service = new ClipProcessorService(dataSource);

    // Process each SQS record (batchSize=1, so typically just one)
    for (const record of event.Records) {
      let message: ClipProcessorMessage;

      try {
        message = JSON.parse(record.body);
      } catch (parseError) {
        console.error(
          'Failed to parse SQS message body:',
          record.body,
          parseError,
        );
        continue; // Skip malformed messages — they'll go to DLQ after maxReceiveCount
      }

      console.log('Processing SQS message', {
        messageId: record.messageId,
        highlightId: message.highlightId,
        recordingId: message.recordingId,
        processingOrder: message.processingOrder,
      });

      const result = await service.processMessage(message);

      console.log('Clip processing result', {
        messageId: record.messageId,
        highlightId: result.highlightId,
        success: result.success,
        action: result.action,
        message: result.message,
      });
    }
  } catch (error) {
    console.error('Fatal error in ClipProcessor Lambda:', {
      error: error?.message || String(error),
      stack: error?.stack,
    });
    // Throwing will cause SQS to make the message visible again after visibility timeout
    throw error;
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
      console.log('Database connection closed');
    }
  }
};
