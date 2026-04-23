import { Handler, Context, S3Event } from 'aws-lambda';
import { DataSource, Repository } from 'typeorm';
import { S3Client, GetObjectTaggingCommand } from '@aws-sdk/client-s3';
import {
  formatLogMessage,
  validateEnvironmentVariables,
} from './utils/lambda.util';
import { MuxUploadService } from './services/mux-upload.service';
import {
  MuxUploadLambdaEvent,
  MuxUploadLambdaResult,
} from './types/lambda.types';
import { Recording } from './types/recording.entity';

/**
 * Gets S3 object tags for a given bucket and key.
 */
const getS3ObjectTags = async (
  bucketName: string,
  key: string,
): Promise<Record<string, string>> => {
  const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
  });

  try {
    const command = new GetObjectTaggingCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);
    const tags: Record<string, string> = {};

    if (response.TagSet) {
      for (const tag of response.TagSet) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }
    }

    return tags;
  } catch (error) {
    console.warn(
      formatLogMessage('Failed to get S3 object tags', {
        bucketName,
        key,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return {};
  }
};

/**
 * Extracts raspberryPiRecordingId from S3 key.
 * Format: recordings/{uuid}_{timestamp}.mp4
 * Returns: {uuid} (the part before the underscore)
 */
const extractRaspberryPiRecordingIdFromKey = (s3Key: string): string => {
  const segments = s3Key.split('/');
  const filename = segments[segments.length - 1]; // Get last segment (filename)

  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // Split by underscore and take first part (index 0)
  const parts = nameWithoutExt.split('_');
  const raspberryPiRecordingId = parts[0];

  if (!raspberryPiRecordingId) {
    throw new Error(
      `Unable to extract raspberryPiRecordingId from S3 key: ${s3Key}`,
    );
  }

  return raspberryPiRecordingId;
};

/**
 * Finds recording by raspberryPiRecordingId and returns the actual recordingId (UUID).
 */
const findRecordingByRaspberryPiId = async (
  repository: Repository<Recording>,
  raspberryPiRecordingId: string,
): Promise<Recording> => {
  const recording = await repository.findOne({
    where: { raspberryPiRecordingId },
  });

  if (!recording) {
    throw new Error(
      `Recording not found for raspberryPiRecordingId: ${raspberryPiRecordingId}`,
    );
  }

  return recording;
};

const buildDataSource = (): DataSource =>
  new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [Recording],
    synchronize: false,
    logging: false,
    ssl:
      process.env.DB_SSL_DISABLED === 'true'
        ? undefined
        : { rejectUnauthorized: false },
  });

export const main: Handler = async (
  event: S3Event,
  context: Context,
): Promise<MuxUploadLambdaResult> => {
  console.log(
    formatLogMessage('Mux upload lambda execution started', {
      requestId: context.awsRequestId,
      remainingTime: context.getRemainingTimeInMillis(),
    }),
  );

  let dataSource: DataSource | undefined;
  let recordingIdForLogs = 'unknown';

  try {
    validateEnvironmentVariables();

    // Validate S3 event structure
    if (!Array.isArray(event?.Records) || event.Records.length === 0) {
      throw new Error('Invalid S3 event: missing Records array');
    }

    const record = event.Records[0];
    if (record.eventSource !== 'aws:s3') {
      throw new Error(`Invalid event source: ${record.eventSource}`);
    }

    const bucketName = record.s3.bucket.name;
    const rawKey = record.s3.object.key;
    const decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));

    console.log(
      formatLogMessage('Processing S3 event', {
        bucketName,
        s3Key: decodedKey,
      }),
    );

    // Try to get raspberryPiRecordingId from S3 object tags first
    const s3Tags = await getS3ObjectTags(bucketName, decodedKey);
    let raspberryPiRecordingId = s3Tags.raspberryPiRecordingId;

    // If not found in tags, extract from S3 key
    if (!raspberryPiRecordingId) {
      console.log(
        formatLogMessage(
          'raspberryPiRecordingId not found in tags, extracting from key',
          {
            tags: s3Tags,
          },
        ),
      );
      raspberryPiRecordingId = extractRaspberryPiRecordingIdFromKey(decodedKey);
    } else {
      console.log(
        formatLogMessage('Found raspberryPiRecordingId in S3 tags', {
          raspberryPiRecordingId,
        }),
      );
    }

    console.log(
      formatLogMessage('Using raspberryPiRecordingId', {
        raspberryPiRecordingId,
        source: s3Tags.raspberryPiRecordingId ? 'tags' : 'key',
      }),
    );

    // Initialize database connection
    dataSource = buildDataSource();
    await dataSource.initialize();
    // Match EB app's IST timezone so NOW() comparisons work with stored timestamps
    await dataSource.query("SET timezone = 'Asia/Kolkata'");

    // Find recording by raspberryPiRecordingId
    const recordingRepository = dataSource.getRepository(Recording);
    const recording = await findRecordingByRaspberryPiId(
      recordingRepository,
      raspberryPiRecordingId,
    );

    recordingIdForLogs = recording.id;
    console.log(
      formatLogMessage('Found recording', {
        recordingId: recording.id,
        raspberryPiRecordingId,
      }),
    );

    // Prepare payload for Mux upload service
    const payload: MuxUploadLambdaEvent = {
      recordingId: recording.id,
      s3Key: decodedKey,
      bucketName,
      watermarkKey: s3Tags.watermarkKey,
      watermarkBucketName: s3Tags.watermarkBucket,
    };

    // Process Mux upload
    const muxUploadService = new MuxUploadService(dataSource);

    const muxUploadResult = await muxUploadService.process(payload);

    await recordingRepository.update(
      { id: recording.id },
      {
        mux_watermark_media_path: s3Tags.watermarkKey,
        mux_watermark_media_bucket: s3Tags.watermarkBucket,
      },
    );
    console.log(
      formatLogMessage('Updated recording with Mux watermark media data', {
        recordingId: recording.id,
        muxWatermarkMediaPath: s3Tags.watermarkKey,
        muxWatermarkMediaBucket: s3Tags.watermarkBucket,
      }),
    );
    return muxUploadResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown lambda failure';

    console.error(
      formatLogMessage('Mux upload lambda execution failed', {
        recordingId: recordingIdForLogs,
        error: message,
      }),
    );

    return {
      success: false,
      recordingId: recordingIdForLogs,
      message,
      error: message,
    };
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  }
};
