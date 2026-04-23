import { DataSource, Repository } from 'typeorm';
import axios from 'axios';
import {
  GetObjectCommand,
  S3Client,
  GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  MuxUploadLambdaEvent,
  MuxUploadLambdaResult,
} from '../types/lambda.types';
import { formatLogMessage } from '../utils/lambda.util';
import { MUX_API_BASE_URL } from 'src/constant/constant';
import { Recording } from '../types/recording.entity';

const DEFAULT_URL_EXPIRY_SECONDS = 604_800; // 7 days

export class MuxUploadService {
  private readonly recordingRepository: Repository<Recording>;
  private readonly s3Client: S3Client;

  constructor(private readonly dataSource: DataSource) {
    this.recordingRepository = this.dataSource.getRepository(Recording);
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
    });
  }

  async process(event: MuxUploadLambdaEvent): Promise<MuxUploadLambdaResult> {
    console.log(
      formatLogMessage('Mux upload lambda invoked', {
        recordingId: event.recordingId,
        bucketName: event.bucketName,
        s3Key: event.s3Key,
        watermarkKey: event.watermarkKey,
        watermarkBucketName: event.watermarkBucketName,
      }),
    );

    const { recordingId, s3Key, watermarkKey, watermarkBucketName } = event;
    const bucketName =
      event.bucketName ||
      `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;

    try {
      this.validateInputs(event, bucketName);

      const presignedUrl =
        event.presignedUrl ||
        (await this.generatePresignedUrl(bucketName, s3Key));

      const cleanUrl = this.cleanUrl(presignedUrl);

      const watermarkUrl = await this.generatePresignedUrl(
        watermarkBucketName,
        watermarkKey,
      );

      const cleanWatermarkUrl = this.cleanUrl(watermarkUrl);

      const asset = await this.createMuxAsset(
        cleanUrl,
        recordingId,
        cleanWatermarkUrl,
      );

      await this.updateRecordingWithMuxData(recordingId, asset, s3Key);

      const playbackId = Array.isArray(asset.playback_ids)
        ? asset.playback_ids.find((id: any) => id?.policy === 'public')?.id ||
          asset.playback_ids[0]?.id
        : undefined;

      const muxMediaUrl = playbackId
        ? `https://stream.mux.com/${playbackId}.m3u8`
        : undefined;

      console.log(
        formatLogMessage('Mux upload lambda completed successfully', {
          recordingId,
          muxAssetId: asset.id,
          muxPlaybackId: playbackId,
        }),
      );

      return {
        success: true,
        recordingId,
        message: 'Mux upload completed successfully',
        muxAssetId: asset.id,
        muxPlaybackId: playbackId,
        muxMediaUrl,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);

      console.error(
        formatLogMessage('Mux upload lambda failed', {
          recordingId,
          error: errorMessage,
        }),
      );

      await this.markRecordingAsFailed(recordingId, errorMessage);

      return {
        success: false,
        recordingId,
        message: 'Mux upload failed',
        error: errorMessage,
      };
    }
  }

  private validateInputs(
    event: MuxUploadLambdaEvent,
    bucketName: string,
  ): void {
    if (!event.recordingId) {
      throw new Error('recordingId is required');
    }

    if (!event.s3Key) {
      throw new Error('s3Key is required');
    }

    const expectedBucket = `${process.env.APP_NAME}-${process.env.ENVIRONMENT}-media`;

    if (bucketName !== expectedBucket) {
      throw new Error(
        `Bucket name mismatch. Expected: ${expectedBucket}, received: ${bucketName}`,
      );
    }

    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
      throw new Error('Mux credentials are not configured');
    }
  }

  private async generatePresignedUrl(
    bucketName: string,
    key: string,
  ): Promise<string> {
    const input: GetObjectCommandInput = {
      Bucket: bucketName,
      Key: key,
    };

    const command = new GetObjectCommand(input);

    return getSignedUrl(this.s3Client, command, {
      expiresIn: DEFAULT_URL_EXPIRY_SECONDS,
    });
  }

  private cleanUrl(url: string): string {
    return String(url)
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\\/g, '')
      .replace(/[\r\n]/g, '');
  }

  private async createMuxAsset(
    cleanUrl: string,
    recordingId: string,
    watermarkUrl: string,
  ) {
    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;

    const muxInputs: any[] = [{ url: cleanUrl }];

    if (watermarkUrl) {
      muxInputs.push({
        url: watermarkUrl,
        overlay_settings: {
          vertical_align: 'bottom',
          vertical_margin: '2%',
          horizontal_align: 'right',
          horizontal_margin: '2%',
        },
      });
    }

    const config = {
      method: 'POST' as const,
      url: `${MUX_API_BASE_URL}/video/v1/assets`,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      auth: {
        username: muxTokenId,
        password: muxTokenSecret,
      },
      data: {
        input: muxInputs,
        playback_policy: ['public'],
        encoding_tier: 'smart',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    };

    const response = await axios(config);
    console.log(
      formatLogMessage('Mux asset created', {
        recordingId,
        status: response.status,
      }),
    );

    return response.data.data;
  }

  private async updateRecordingWithMuxData(
    recordingId: string,
    asset: any,
    s3Key: string,
  ): Promise<void> {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      console.warn(
        formatLogMessage('Recording not found while updating Mux data', {
          recordingId,
        }),
      );
      return;
    }

    recording.mux_asset_id = asset.id;
    const playbackId = Array.isArray(asset.playback_ids)
      ? asset.playback_ids[0]?.id
      : undefined;

    if (playbackId) {
      recording.mux_playback_id = playbackId;
      recording.mux_media_url = `https://stream.mux.com/${playbackId}.m3u8`;
    }

    recording.status = 'completed';
    // Mark video as created to prevent duplicate creation
    recording.isVideoCreated = true;
    if (!recording.s3Path) {
      recording.s3Path = s3Key;
    }

    await this.recordingRepository.save(recording);

    console.log(
      formatLogMessage(
        'Recording updated with Mux data and isVideoCreated flag',
        {
          recordingId,
          muxAssetId: asset.id,
          isVideoCreated: true,
        },
      ),
    );
  }

  private async markRecordingAsFailed(
    recordingId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.recordingRepository.update(recordingId, {
        status: 'failed',
      });
    } catch (updateError) {
      console.error(
        formatLogMessage('Failed to mark recording as failed', {
          recordingId,
          originalError: errorMessage,
          updateError:
            updateError instanceof Error
              ? updateError.message
              : JSON.stringify(updateError),
        }),
      );
    }
  }
}
