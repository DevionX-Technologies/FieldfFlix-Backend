import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Recording } from '../recording/entities/recording.entity';
import { Camera } from '../camera/camera.entity';
import { SharedRecording } from '../recording/entities/shared-recording.entity';
import { CloudflareR2StorageAdapter } from '../media-provider/adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamVodAdapter } from '../media-provider/adapters/cloudflare-stream-vod.adapter';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import { CloudflareRecordingExtractDto } from './dto/cloudflare-recording-extract.dto';
import { CloudflareRecordingCallbackDto } from './dto/cloudflare-recording-callback.dto';

@Injectable()
export class CloudflareRecordingsService {
  private readonly logger = new Logger(CloudflareRecordingsService.name);

  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepository: Repository<Recording>,
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(SharedRecording)
    private readonly sharedRecordingRepository: Repository<SharedRecording>,
    private readonly r2Adapter: CloudflareR2StorageAdapter,
    private readonly streamAdapter: CloudflareStreamVodAdapter,
    private readonly piApi: RaspberryPiApiService,
    private readonly configService: ConfigService,
  ) {}

  private requiredConfig(name: string): string {
    const value = this.configService.get<string>(name) ?? process.env[name];
    if (!value?.trim()) {
      throw new ServiceUnavailableException(
        `Cloudflare recordings is not configured: ${name} is missing`,
      );
    }
    return value.trim();
  }

  private getBucket(): string {
    return this.requiredConfig('CLOUDFLARE_R2_BUCKET_NAME');
  }

  private getCallbackUrl(): string {
    return `${this.requiredConfig('APP_BASE_URL')}/cloudflare-recordings/callback`;
  }

  private getMetadata(recording: Recording): Record<string, any> {
    return (recording.metadata ?? {}) as Record<string, any>;
  }

  async extract(
    dto: CloudflareRecordingExtractDto,
    userId: string,
  ): Promise<{
    recordingId: string;
    status: string;
    r2Key: string;
    uploadUrl: string;
  }> {
    const camera = await this.cameraRepository.findOne({
      where: { id: dto.cameraId },
      relations: ['turf'],
    });
    if (!camera)
      throw new NotFoundException(`Camera not found: ${dto.cameraId}`);
    if (!camera.raspberryPiBaseUrl) {
      throw new BadRequestException(
        'Camera has no Raspberry Pi gateway configured',
      );
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException('endTime must be after startTime');
    }

    const bucket = this.getBucket();
    const recordingId = uuidv4();
    const key = `recordings/${recordingId}_${Date.now()}.mp4`;
    const upload = await this.r2Adapter.generateUploadPresignedUrl({
      bucket,
      key,
      contentType: 'video/mp4',
      expiresInSeconds: 7200,
    });
    const channel = dto.channel ?? camera.court_number ?? 1;
    const recording = this.recordingRepository.create({
      id: recordingId,
      userId,
      turfId: camera.turfId,
      cameraId: camera.id,
      startTime: start,
      endTime: end,
      status: 'extracting',
      s3Path: `r2://${bucket}/${key}`,
      metadata: {
        provider: 'cloudflare',
        storage_provider: 'r2',
        r2Bucket: bucket,
        r2Key: key,
        r2Status: 'uploading',
        r2VerifiedAt: null,
        game_id: dto.gameId ?? null,
        nvr_channel: channel,
        extract_attempts: 1,
      },
    });
    await this.recordingRepository.save(recording);

    try {
      await this.piApi.extractSession(
        camera.raspberryPiBaseUrl,
        {
          recordingId,
          channel,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          uploadUrl: upload.uploadUrl,
          s3Key: key,
          callbackWebhookUrl: this.getCallbackUrl(),
        },
        camera.raspberryPiApiKey,
      );
    } catch (error: any) {
      await this.recordingRepository.update(recordingId, {
        status: 'failed',
        metadata: {
          ...this.getMetadata(recording),
          r2Status: 'dispatch_failed',
          extract_failed_reason: error?.message ?? 'Pi dispatch failed',
        } as any,
      });
      throw error;
    }

    return {
      recordingId,
      status: 'extracting',
      r2Key: key,
      uploadUrl: upload.uploadUrl,
    };
  }

  async handleCallback(dto: CloudflareRecordingCallbackDto) {
    const recording = await this.recordingRepository.findOne({
      where: { id: dto.recordingId },
    });
    if (!recording)
      throw new NotFoundException(`Recording not found: ${dto.recordingId}`);

    const metadata = this.getMetadata(recording);
    if (dto.status === 'FAILED') {
      await this.recordingRepository.update(recording.id, {
        status: 'failed',
        metadata: {
          ...metadata,
          r2Status: 'failed',
          extract_failed_reason: dto.error ?? 'Pi extraction failed',
        } as any,
      });
      return { success: false, status: 'failed' };
    }

    const bucket = metadata.r2Bucket ?? this.getBucket();
    const key = dto.r2Key ?? metadata.r2Key;
    if (!key) throw new BadRequestException('R2 object key is missing');
    const object = await this.r2Adapter.headObject(key, bucket);
    if (!object || object.sizeBytes <= 0) {
      await this.recordingRepository.update(recording.id, {
        status: 'processing',
        metadata: {
          ...metadata,
          r2Status: 'verification_pending',
          r2VerifiedAt: null,
        } as any,
      });
      return { success: false, status: 'verification_pending' };
    }

    const verifiedMetadata = {
      ...metadata,
      r2Bucket: bucket,
      r2Key: key,
      r2Status: 'ready',
      r2VerifiedAt: new Date().toISOString(),
      r2ObjectSizeBytes: object.sizeBytes,
      durationSeconds: dto.durationSeconds ?? metadata.durationSeconds ?? null,
      cloudflareStreamStatus: 'not_started',
    };
    await this.recordingRepository.update(recording.id, {
      status: 'ready',
      isVideoCreated: true,
      s3Path: `r2://${bucket}/${key}`,
      metadata: verifiedMetadata as any,
    });

    try {
      const source = await this.r2Adapter.generateDownloadPresignedUrl({
        bucket,
        key,
        expiresInSeconds: 21600,
      });
      const asset = await this.streamAdapter.createAssetFromUrl({
        sourceUrl: source.downloadUrl,
        passthrough: recording.id,
        name: `Recording ${recording.id}`,
      });
      await this.recordingRepository.update(recording.id, {
        mux_playback_id: asset.playbackId ?? null,
        mux_media_url: asset.playbackUrl ?? null,
        metadata: {
          ...verifiedMetadata,
          cloudflareStreamUid: asset.assetId,
          cloudflareStreamStatus:
            asset.status === 'ready' ? 'ready' : 'processing',
          streamCopyStartedAt: new Date().toISOString(),
        } as any,
      });
    } catch (error: any) {
      this.logger.warn(
        `Stream ingestion failed for ${recording.id}: ${error?.message ?? error}`,
      );
    }

    return { success: true, status: 'ready', r2Verified: true };
  }

  async getPlayback(recordingId: string, userId: string) {
    const recording = await this.getAuthorizedRecording(recordingId, userId);
    const metadata = this.getMetadata(recording);
    const bucket = metadata.r2Bucket ?? this.getBucket();
    const key =
      metadata.r2Key ?? recording.s3Path?.replace(/^r2:\/\/[^/]+\//, '');
    let r2Url: string | null = null;
    if (key && metadata.r2VerifiedAt) {
      const object = await this.r2Adapter.headObject(key, bucket);
      if (object && object.sizeBytes > 0) {
        r2Url = (
          await this.r2Adapter.generateDownloadPresignedUrl({
            bucket,
            key,
            expiresInSeconds: 900,
          })
        ).downloadUrl;
      }
    }
    const streamReady =
      metadata.cloudflareStreamStatus === 'ready' &&
      Boolean(metadata.cloudflareStreamUid);
    const streamUrl = streamReady
      ? `https://videodelivery.net/${metadata.cloudflareStreamUid}/manifest/video.m3u8`
      : null;
    return {
      recordingId,
      status: streamReady
        ? 'STREAM_READY'
        : r2Url
          ? 'R2_READY'
          : String(recording.status ?? 'PROCESSING').toUpperCase(),
      activeProvider: streamUrl
        ? 'CLOUDFLARE_STREAM'
        : r2Url
          ? 'CLOUDFLARE_R2'
          : 'NONE',
      activeUrl: streamUrl ?? r2Url,
      r2: { available: Boolean(r2Url), url: r2Url, key: key ?? null },
      stream: {
        available: streamReady,
        url: streamUrl,
        uid: metadata.cloudflareStreamUid ?? null,
      },
    };
  }

  async getTimeline(recordingId: string, userId: string) {
    const recording = await this.getAuthorizedRecording(recordingId, userId);
    const metadata = this.getMetadata(recording);
    const start = recording.startTime?.toISOString() ?? null;
    const end = recording.endTime?.toISOString() ?? null;
    const expected =
      start && end
        ? Math.max(
            0,
            (new Date(end).getTime() - new Date(start).getTime()) / 1000,
          )
        : null;
    const duration = Number(metadata.durationSeconds);
    const playable =
      Boolean(metadata.r2VerifiedAt) ||
      metadata.cloudflareStreamStatus === 'ready';
    return {
      recordingId,
      matchStartTime: start,
      matchEndTime: end,
      expectedDurationSeconds: expected,
      availableDurationSeconds:
        playable && Number.isFinite(duration) ? duration : 0,
      status: playable
        ? 'AVAILABLE'
        : String(recording.status ?? 'PROCESSING').toUpperCase(),
      segments:
        playable && Number.isFinite(duration) && duration > 0
          ? [
              {
                id: recording.id,
                sequence: 1,
                matchStartOffsetSeconds: 0,
                matchEndOffsetSeconds: duration,
                durationSeconds: duration,
                r2Status: metadata.r2VerifiedAt ? 'AVAILABLE' : 'NOT_AVAILABLE',
                streamStatus: String(
                  metadata.cloudflareStreamStatus ?? 'NOT_STARTED',
                ).toUpperCase(),
                playbackStatus: 'AVAILABLE',
              },
            ]
          : [],
    };
  }

  /**
   * Generates a presigned upload URL for a known R2 key.
   * Used by ExtractionQueueService to obtain a fresh upload URL at dispatch time.
   */
  async generateUploadUrl(r2Key: string): Promise<{ uploadUrl: string; key: string }> {
    const bucket = this.getBucket();
    const upload = await this.r2Adapter.generateUploadPresignedUrl({
      bucket,
      key: r2Key,
      contentType: 'video/mp4',
      expiresInSeconds: 7200, // 2 hours
    });
    return { uploadUrl: upload.uploadUrl, key: r2Key };
  }

  private async getAuthorizedRecording(recordingId: string, userId: string) {
    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
      relations: ['sharedRecordings'],
    });
    if (!recording)
      throw new NotFoundException(`Recording not found: ${recordingId}`);
    const shared = (recording.sharedRecordings ?? []).some(
      (row: SharedRecording) => row.shared_with_user_id === userId,
    );
    if (recording.userId !== userId && !shared) {
      throw new ForbiddenException('You do not have access to this recording');
    }
    return recording;
  }
}
