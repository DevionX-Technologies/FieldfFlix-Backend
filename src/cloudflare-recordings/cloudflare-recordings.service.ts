import {
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

import { Recording } from '../recording/entities/recording.entity';
import { Camera } from '../camera/camera.entity';
import { SharedRecording } from '../recording/entities/shared-recording.entity';
import { CloudflareR2StorageAdapter } from '../media-provider/adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamVodAdapter } from '../media-provider/adapters/cloudflare-stream-vod.adapter';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import type { MultipartUploadInstruction } from '../raspberry-pi/raspberry-pi-api.service';
import { ExtractionJobProgressService } from '../extraction-queue/extraction-job-progress.service';
import { CloudflareRecordingExtractDto } from './dto/cloudflare-recording-extract.dto';
import { CloudflareRecordingCallbackDto } from './dto/cloudflare-recording-callback.dto';

/** Replay window for signed Pi callbacks, in seconds. */
const CALLBACK_SIGNATURE_TOLERANCE_SECONDS = 300;

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
    private readonly jobProgress: ExtractionJobProgressService,
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

  private env(name: string): string | undefined {
    return (
      this.configService.get<string>(name) ?? process.env[name]
    )?.toString();
  }

  /**
   * Verifies the HMAC-SHA256 signature a venue Pi attaches to its callback.
   *
   * The Pi signs `${timestamp}.${rawBody}` with `PI_CALLBACK_SECRET` and sends
   * `x-pi-timestamp` / `x-pi-signature` as headers (same scheme as the
   * Cloudflare Stream webhook), keeping the signature out of the signed bytes.
   *
   * Fails CLOSED whenever `PI_CALLBACK_REQUIRE_SIGNATURE` is not explicitly
   * disabled, so a missing secret can never silently downgrade to an open
   * endpoint. The escape hatch exists only for local development.
   */
  private verifyCallbackSignature(
    rawBody: string | null,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): void {
    const required =
      (this.env('PI_CALLBACK_REQUIRE_SIGNATURE') ?? 'true').toLowerCase() !==
      'false';
    const secret = this.env('PI_CALLBACK_SECRET');

    if (!secret) {
      if (required) {
        this.logger.error(
          'PI_CALLBACK_SECRET is not configured; rejecting unsigned Pi callback. Set PI_CALLBACK_SECRET, or explicitly set PI_CALLBACK_REQUIRE_SIGNATURE=false for local development.',
        );
        throw new ServiceUnavailableException(
          'Pi callback signature verification is not configured',
        );
      }
      this.logger.warn(
        'PI_CALLBACK_SECRET missing and PI_CALLBACK_REQUIRE_SIGNATURE=false — callback signature check bypassed (development only).',
      );
      return;
    }

    if (!signatureHeader || !timestampHeader) {
      throw new UnauthorizedException(
        'Missing x-pi-signature or x-pi-timestamp header',
      );
    }
    if (!rawBody) {
      throw new UnauthorizedException(
        'Missing raw request body for verification',
      );
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      throw new UnauthorizedException('Malformed x-pi-timestamp header');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      Math.abs(nowSeconds - timestamp) > CALLBACK_SIGNATURE_TOLERANCE_SECONDS
    ) {
      throw new UnauthorizedException('Callback signature has expired');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');

    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      this.logger.warn('Rejected Pi callback: signature verification failed');
      throw new UnauthorizedException('Callback signature verification failed');
    }
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

  async handleCallback(
    dto: CloudflareRecordingCallbackDto,
    rawBody?: string | null,
    signatureHeader?: string,
    timestampHeader?: string,
  ) {
    this.verifyCallbackSignature(
      rawBody ?? null,
      signatureHeader,
      timestampHeader,
    );

    const recording = await this.recordingRepository.findOne({
      where: { id: dto.recordingId },
    });
    if (!recording)
      throw new NotFoundException(`Recording not found: ${dto.recordingId}`);

    const metadata = this.getMetadata(recording);

    if (dto.status === 'FAILED') {
      // A device that began a multipart upload and then failed leaves the parts
      // behind, and R2 bills/holds them until they are explicitly aborted.
      if (dto.uploadId) {
        const failedKey = dto.r2Key ?? this.getMetadata(recording).r2Key;
        const failedBucket =
          this.getMetadata(recording).r2Bucket ?? this.getBucket();
        if (failedKey) {
          const abort = await this.r2Adapter.abortMultipartUpload(
            dto.uploadId,
            failedKey,
            failedBucket,
          );
          this.logger.log(
            `[VIDEO-UPLOAD] recording=${recording.id} storage=R2 method=multipart-abort ` +
              `uploadId=${dto.uploadId} success=${abort.success}`,
          );
        }
      }

      // Never let a failure callback demote a recording that is already playable.
      const applied = await this.jobProgress.onTerminalFailure(
        recording.id,
        dto.error ?? 'Pi extraction failed',
      );
      if (!applied.applied) {
        return {
          success: false,
          status: String(recording.status),
          ignored: applied.reason,
        };
      }
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

    // The callback must not be able to point the recording at an arbitrary key.
    const expectedKey = metadata.r2Key;
    if (expectedKey && key !== expectedKey) {
      this.logger.warn(
        `Rejected Pi callback for recording=${recording.id}: r2Key mismatch`,
      );
      throw new BadRequestException('R2 object key does not match the request');
    }

    // Multipart uploads must be completed BEFORE verifying the object: R2 does
    // not expose the object until CompleteMultipartUpload succeeds, so a
    // headObject here would otherwise report "verification_pending" forever and
    // the parts would be billed indefinitely.
    if (dto.uploadId && dto.parts?.length) {
      try {
        const completed = await this.r2Adapter.completeMultipartUpload(
          dto.uploadId,
          key,
          dto.parts,
          bucket,
        );
        this.logger.log(
          `[VIDEO-UPLOAD] recording=${recording.id} storage=R2 method=multipart ` +
            `parts=${dto.parts.length} partSizeBytes=${metadata.r2PartSizeBytes ?? 'unknown'} ` +
            `retriedParts=${dto.retriedPartCount ?? 0} failedParts=${dto.failedPartCount ?? 0} ` +
            `durationMs=${this.uploadDurationMs(dto)} ` +
            `throughputMBps=${this.throughputMBps(dto)} etag=${completed.etag ?? 'n/a'}`,
        );
      } catch (completeErr: any) {
        // Leave the parts in place so a retry can resume rather than restart.
        this.logger.error(
          `Failed to complete multipart upload for recording=${recording.id} ` +
            `(uploadId=${dto.uploadId}): ${completeErr?.message}`,
        );
        await this.recordingRepository.update(recording.id, {
          metadata: {
            ...metadata,
            r2Status: 'multipart_completion_failed',
            r2UploadId: dto.uploadId,
          } as any,
        });
        throw new BadGatewayException(
          'R2 multipart completion failed; the device should retry the failed parts',
        );
      }
    }

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

    // R2 object is confirmed present and non-empty: advance the job pipeline.
    await this.jobProgress.onR2Verified(recording.id, {
      nvrDownloadCompletedAt: dto.nvrDownloadCompletedAt
        ? new Date(dto.nvrDownloadCompletedAt)
        : null,
      uploadStartedAt: dto.uploadStartedAt
        ? new Date(dto.uploadStartedAt)
        : null,
      uploadCompletedAt: dto.uploadCompletedAt
        ? new Date(dto.uploadCompletedAt)
        : null,
    });

    await this.recordingRepository.update(recording.id, {
      status: 'ready',
      isVideoCreated: true,
      s3Path: `r2://${bucket}/${key}`,
      metadata: verifiedMetadata as any,
    });

    try {
      await this.jobProgress.onStreamImportStarted(recording.id);
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
      const playbackUrl =
        asset.playbackUrl ??
        `https://videodelivery.net/${asset.assetId}/manifest/video.m3u8`;

      // NOTE: Cloudflare Stream values go in the `cloudflare*` namespace.
      // `mux_playback_id` / `mux_media_url` are reserved for the Mux provider
      // and are left untouched here.
      await this.recordingRepository.update(recording.id, {
        metadata: {
          ...verifiedMetadata,
          cloudflareStreamUid: asset.assetId,
          cloudflareStreamStatus:
            asset.status === 'ready' ? 'ready' : 'processing',
          cloudflarePlaybackUrl: playbackUrl,
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

  /**
   * Upload wall-clock time as reported by the device. Falls back to null when
   * the device did not send timestamps, so telemetry never fabricates numbers.
   */
  private uploadDurationMs(dto: CloudflareRecordingCallbackDto): number | null {
    if (!dto.uploadStartedAt || !dto.uploadCompletedAt) return null;
    const started = Date.parse(dto.uploadStartedAt);
    const completed = Date.parse(dto.uploadCompletedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
    const ms = completed - started;
    return ms >= 0 ? ms : null;
  }

  /** Upload throughput in MB/s, or null when size/duration is unknown. */
  private throughputMBps(dto: CloudflareRecordingCallbackDto): number | null {
    const ms = this.uploadDurationMs(dto);
    if (ms === null || !dto.fileSizeBytes || ms <= 0) return null;
    const mb = dto.fileSizeBytes / (1024 * 1024);
    return Math.round((mb / (ms / 1000)) * 100) / 100;
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
  /**
   * Generates a presigned upload URL for a known R2 key, plus — when the
   * expected object size is known — a multipart plan the device can use for
   * parallel, resumable, per-part-retryable upload.
   *
   * `expectedSizeBytes` is optional on purpose. When the backend does not know
   * the size up front the device receives only the single-shot `uploadUrl`,
   * which preserves the previous behaviour exactly.
   */
  async generateUploadUrl(
    r2Key: string,
    expectedSizeBytes?: number,
  ): Promise<{
    uploadUrl: string;
    key: string;
    multipart?: MultipartUploadInstruction;
  }> {
    const bucket = this.getBucket();
    const upload = await this.r2Adapter.generateUploadPresignedUrl({
      bucket,
      key: r2Key,
      contentType: 'video/mp4',
      expiresInSeconds: 7200, // 2 hours
      expectedSizeBytes,
    });

    if (!upload.multipart) {
      return { uploadUrl: upload.uploadUrl, key: r2Key };
    }

    return {
      uploadUrl: upload.uploadUrl,
      key: r2Key,
      multipart: {
        uploadId: upload.multipart.uploadId,
        partSizeBytes: upload.multipart.partSizeBytes,
        partCount: upload.multipart.partCount,
        concurrency: upload.multipart.concurrency,
        partUrls: upload.multipart.partUrls,
      },
    };
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
