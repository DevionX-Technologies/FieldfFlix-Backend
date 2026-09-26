import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';

import { CloudflareR2StorageAdapter } from '../media-provider/adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamVodAdapter } from '../media-provider/adapters/cloudflare-stream-vod.adapter';
import { CloudflareStreamLiveAdapter } from '../media-provider/adapters/cloudflare-stream-live.adapter';
import { CloudflarePlaybackTokenService } from '../media-provider/services/cloudflare-playback-token.service';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';

import { Recording } from '../recording/entities/recording.entity';
import { Camera } from '../camera/camera.entity';
import { RecordingHighlights } from '../recording/entities/recording-highlights.entity';
import { TournamentEntity } from '../tournament/entities/tournament.entity';

import { CloudflareExtractSessionDto } from './dto/cloudflare-extract.dto';
import { CloudflareCallbackDto } from './dto/cloudflare-callback.dto';
import {
  CloudflarePlaybackResponseDto,
  CloudflareR2PlaybackDetails,
  CloudflareStreamPlaybackDetails,
} from './dto/cloudflare-playback.dto';
import {
  CloudflareStartLiveStreamDto,
  CloudflareStopLiveStreamDto,
} from './dto/cloudflare-live.dto';
import { CloudflareCreateClipDto } from './dto/cloudflare-clip.dto';
import {
  liveStreamCameraId,
  resolveLiveStreamSlot,
  upsertTournamentLiveStream,
} from '../utils/live-stream-slots.util';

@Injectable()
export class CloudflareMediaService {
  private readonly logger = new Logger(CloudflareMediaService.name);

  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectRepository(Camera)
    private readonly cameraRepo: Repository<Camera>,
    @InjectRepository(RecordingHighlights)
    private readonly highlightRepo: Repository<RecordingHighlights>,
    @InjectRepository(TournamentEntity)
    private readonly tournamentRepo: Repository<TournamentEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly r2Adapter: CloudflareR2StorageAdapter,
    private readonly vodAdapter: CloudflareStreamVodAdapter,
    private readonly liveAdapter: CloudflareStreamLiveAdapter,
    private readonly tokenService: CloudflarePlaybackTokenService,
    private readonly piApiService: RaspberryPiApiService,
    private readonly configService: ConfigService,
  ) {}

  private getDefaultR2Bucket(): string {
    const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    if (bucket && bucket.trim() !== '') {
      return bucket.trim();
    }
    return 'fieldflicks-production-media';
  }

  private getAppBaseUrl(): string {
    return (
      this.configService.get<string>('APP_BASE_URL') ||
      process.env.APP_BASE_URL ||
      'https://api.fieldflicks.com'
    );
  }

  /**
   * 1. On-Demand Extraction: Commands Pi NVR to extract video directly into Cloudflare R2
   */
  async extractSessionToR2(
    dto: CloudflareExtractSessionDto,
    userId?: string,
  ): Promise<{
    recordingId: string;
    status: string;
    r2Key: string;
    channel: number;
    uploadUrl: string;
  }> {
    const camera = await this.cameraRepo.findOne({
      where: { id: dto.cameraId },
      relations: ['turf'],
    });

    if (!camera) {
      throw new NotFoundException(`Camera not found: ${dto.cameraId}`);
    }

    if (!camera.raspberryPiBaseUrl) {
      throw new BadRequestException(
        `Camera ${camera.id} (${camera.name}) has no Raspberry Pi gateway URL configured`,
      );
    }

    const channelNumber = dto.channel ?? camera.court_number ?? 1;
    const startDate = new Date(dto.startTime);
    const endDate = new Date(dto.endTime);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException(
        'Invalid startTime or endTime ISO timestamp',
      );
    }
    if (endDate <= startDate) {
      throw new BadRequestException('endTime must be after startTime');
    }

    const recordingId = uuidv4();
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.]/g, '')
      .slice(0, 14);
    const r2Key = `recordings/${recordingId}_${timestamp}.mp4`;
    const bucketName = this.getDefaultR2Bucket();

    // Generate Cloudflare R2 Presigned PUT URL (2 hours expiry)
    const { uploadUrl } = await this.r2Adapter.generateUploadPresignedUrl({
      key: r2Key,
      bucket: bucketName,
      contentType: 'video/mp4',
      expiresInSeconds: 7200,
    });

    // Create recording entity in database
    const recording = this.recordingRepo.create({
      id: recordingId,
      userId: userId || dto.userId || null,
      turfId: camera.turfId,
      cameraId: camera.id,
      startTime: startDate,
      endTime: endDate,
      status: 'extracting',
      s3Path: `r2://${bucketName}/${r2Key}`,
      metadata: {
        provider: 'cloudflare',
        storage_provider: 'r2',
        vod_provider: 'cloudflare',
        nvr_channel: channelNumber,
        court_number: camera.court_number,
        r2Key,
        r2Bucket: bucketName,
        r2Status: 'uploading',
        expected_s3_key: r2Key,
        game_id: dto.gameId,
        extract_attempts: 1,
        created_at: new Date().toISOString(),
      },
    });

    await this.recordingRepo.save(recording);

    // Dispatch extraction to edge venue hardware
    const callbackWebhookUrl = `${this.getAppBaseUrl()}/cloudflare/media/callback`;
    this.logger.log(
      `Dispatching extraction to Pi (${camera.raspberryPiBaseUrl}) for Recording ${recordingId} -> R2 Key ${r2Key}`,
    );

    this.piApiService
      .extractSession(
        camera.raspberryPiBaseUrl,
        {
          recordingId,
          channel: channelNumber,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          uploadUrl,
          s3Key: r2Key,
          callbackWebhookUrl,
        },
        camera.raspberryPiApiKey,
      )
      .then((res) => {
        this.logger.log(
          `Pi extraction accepted for ${recordingId}: status=${res.status}`,
        );
      })
      .catch((err) => {
        this.logger.warn(
          `Pi extraction dispatch warning for ${recordingId}: ${err.message}`,
        );
      });

    return {
      recordingId,
      status: 'extracting',
      r2Key,
      channel: channelNumber,
      uploadUrl,
    };
  }

  /**
   * 2. Callback from Raspberry Pi when upload to Cloudflare R2 finishes.
   *    Immediately marks the video playable from R2, and in parallel kicks off
   *    Cloudflare Stream multi-bitrate HLS encoding!
   */
  async handleR2Callback(
    dto: CloudflareCallbackDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(
      `Received Cloudflare R2 callback for Recording ${dto.recordingId}: status=${dto.status}`,
    );

    const recording = await this.recordingRepo.findOne({
      where: { id: dto.recordingId },
    });

    if (!recording) {
      throw new NotFoundException(
        `Recording with ID ${dto.recordingId} not found`,
      );
    }

    const meta = (recording.metadata ?? {}) as Record<string, any>;
    const bucketName = meta.r2Bucket || this.getDefaultR2Bucket();
    const key = dto.r2Key || dto.s3Key || meta.r2Key;

    if (dto.status !== 'SUCCESS') {
      await this.recordingRepo.update(recording.id, {
        status: 'failed',
        metadata: {
          ...meta,
          r2Status: 'failed',
          extract_failed_reason: dto.error || 'Pi reported extraction failure',
          failed_at: new Date().toISOString(),
        } as any,
      });
      return { success: false, message: 'Extraction marked as failed' };
    }

    if (!key) {
      await this.recordingRepo.update(recording.id, {
        status: 'failed',
        metadata: {
          ...meta,
          r2Status: 'verification_failed',
          extract_failed_reason: 'R2 callback did not include an object key',
          failed_at: new Date().toISOString(),
        } as any,
      });
      return { success: false, message: 'R2 object key is missing' };
    }

    let verifiedObject;
    try {
      verifiedObject = await this.r2Adapter.headObject(key, bucketName);
    } catch (error: any) {
      this.logger.warn(
        `R2 verification failed for ${recording.id}: ${error?.message ?? error}`,
      );
    }

    if (!verifiedObject || verifiedObject.sizeBytes <= 0) {
      await this.recordingRepo.update(recording.id, {
        status: 'failed',
        metadata: {
          ...meta,
          r2Key: key,
          r2Bucket: bucketName,
          r2Status: 'verification_failed',
          extract_failed_reason: 'R2 object was not found or was empty',
          failed_at: new Date().toISOString(),
        } as any,
      });
      return {
        success: false,
        message: 'R2 object was not found or was empty',
      };
    }

    // The recording is ready only after the object is verified in R2.
    await this.recordingRepo.update(recording.id, {
      status: 'ready',
      isVideoCreated: true,
      metadata: {
        ...meta,
        r2Key: key,
        r2Bucket: bucketName,
        r2Status: 'ready',
        r2VerifiedAt: new Date().toISOString(),
        r2ObjectSize: verifiedObject.sizeBytes,
        r2ObjectEtag: verifiedObject.etag,
        r2UploadedAt: new Date().toISOString(),
        durationSeconds: dto.durationSeconds || meta.durationSeconds,
        fileSizeBytes: dto.fileSizeBytes || meta.fileSizeBytes,
        cloudflareStreamStatus: 'processing',
      } as any,
    });

    this.logger.log(
      `Recording ${recording.id} is now IMMEDIATELY PLAYABLE from R2! Kicking off parallel Cloudflare Stream ingest...`,
    );

    // Step B: Parallel Ingest into Cloudflare Stream VOD
    try {
      // Generate a signed download URL from R2 for Cloudflare Stream copy (valid 6 hours)
      const downloadOutput = await this.r2Adapter.generateDownloadPresignedUrl({
        key,
        bucket: bucketName,
        expiresInSeconds: 21600,
      });

      const cfAsset = await this.vodAdapter.createAssetFromUrl({
        sourceUrl: downloadOutput.downloadUrl,
        passthrough: recording.id,
        name: `Recording ${recording.id}`,
      });

      await this.recordingRepo.update(recording.id, {
        mux_playback_id: cfAsset.playbackId || null,
        mux_media_url: cfAsset.playbackUrl || null,
        metadata: {
          ...meta,
          r2Key: key,
          r2Bucket: bucketName,
          r2Status: 'ready',
          cloudflareStreamUid: cfAsset.assetId,
          cloudflareStreamStatus:
            cfAsset.status === 'ready' ? 'ready' : 'processing',
          cloudflarePlaybackUrl: cfAsset.playbackUrl,
          streamCopyStartedAt: new Date().toISOString(),
        } as any,
      });

      this.logger.log(
        `Cloudflare Stream copy initiated for ${recording.id}: UID=${cfAsset.assetId}, initialStatus=${cfAsset.status}`,
      );
    } catch (cfErr: any) {
      this.logger.warn(
        `Cloudflare Stream copy failed for ${recording.id}: ${cfErr?.message}. Recording remains directly playable from R2.`,
      );
    }

    return {
      success: true,
      message:
        'Video is immediately playable from R2; Cloudflare Stream transcoding running in background.',
    };
  }

  /**
   * 3. Dual Playback Resolver:
   *    - If Cloudflare Stream has finished transcoding -> plays adaptive bitrate HLS from Cloudflare Stream!
   *    - If Cloudflare Stream is still transcoding -> plays progressive MP4 directly from Cloudflare R2!
   *    Users NEVER wait on transcode queues.
   */
  async getPlayback(
    recordingId: string,
    ttlSeconds = 21600,
  ): Promise<CloudflarePlaybackResponseDto> {
    const recording = await this.recordingRepo.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException(`Recording ${recordingId} not found`);
    }

    const meta = (recording.metadata ?? {}) as Record<string, any>;
    const status = String(recording.status ?? '').toLowerCase();

    // 1. Resolve R2 Storage Availability
    const r2Key =
      meta.r2Key ||
      meta.expected_s3_key ||
      recording.s3Path?.replace(/^(r2|s3):\/\/[^/]+\//, '');
    const r2Bucket = meta.r2Bucket || this.getDefaultR2Bucket();

    let r2Details: CloudflareR2PlaybackDetails = {
      available: false,
      url: null,
      key: r2Key || null,
      bucket: r2Bucket || null,
      expiresAt: null,
    };

    if (
      r2Key &&
      (meta.r2Status === 'ready' ||
        status === 'ready' ||
        status === 'completed')
    ) {
      try {
        const verifiedObject = await this.r2Adapter.headObject(r2Key, r2Bucket);
        if (!verifiedObject || verifiedObject.sizeBytes <= 0) {
          throw new Error('R2 object was not found or was empty');
        }
        const downloadOutput =
          await this.r2Adapter.generateDownloadPresignedUrl({
            key: r2Key,
            bucket: r2Bucket,
            expiresInSeconds: ttlSeconds,
          });

        r2Details = {
          available: true,
          url: downloadOutput.downloadUrl,
          key: r2Key,
          bucket: r2Bucket,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        };
      } catch (err: any) {
        this.logger.warn(
          `Failed to generate R2 download URL for ${recordingId}: ${err?.message}`,
        );
      }
    }

    // 2. Resolve Cloudflare Stream Availability
    const streamUid =
      meta.cloudflareStreamUid ||
      (recording.mux_playback_id &&
      /^[a-f0-9]{32}$/i.test(recording.mux_playback_id)
        ? recording.mux_playback_id
        : null);

    const isStreamReady = meta.cloudflareStreamStatus === 'ready';
    let streamManifestUrl: string | null = streamUid
      ? `https://videodelivery.net/${streamUid}/manifest/video.m3u8`
      : null;
    let playbackToken: string | null = null;

    if (streamUid && isStreamReady) {
      try {
        const res = await this.tokenService.generateSignedToken(
          streamUid,
          ttlSeconds,
        );
        playbackToken = res.token;
        streamManifestUrl = `https://videodelivery.net/${playbackToken}/manifest/video.m3u8`;
      } catch {
        // Fallback to public manifest if token service is unconfigured
      }
    }

    const streamDetails: CloudflareStreamPlaybackDetails = {
      available: isStreamReady,
      videoUid: streamUid,
      manifestUrl: streamManifestUrl,
      playbackToken,
      status: isStreamReady
        ? 'ready'
        : streamUid
          ? 'processing'
          : 'not_started',
    };

    // 3. Dynamic Selection:
    // If Cloudflare Stream HLS is ready -> use it!
    // Otherwise -> directly use R2 progressive MP4!
    const activeProvider = isStreamReady
      ? 'CLOUDFLARE_STREAM'
      : 'CLOUDFLARE_R2';
    const activeUrl = isStreamReady
      ? streamManifestUrl!
      : r2Details.url || streamManifestUrl || '';

    let lifecycleStatus: CloudflarePlaybackResponseDto['status'] = 'UPLOADING';
    if (status === 'failed') {
      lifecycleStatus = 'FAILED';
    } else if (isStreamReady) {
      lifecycleStatus = 'STREAM_READY';
    } else if (r2Details.available) {
      lifecycleStatus = streamUid ? 'STREAM_PROCESSING' : 'R2_READY';
    }

    return {
      recordingId: recording.id,
      activeUrl,
      activeProvider,
      status: lifecycleStatus,
      r2: r2Details,
      stream: streamDetails,
      durationSeconds:
        (recording as any).duration || meta.durationSeconds || undefined,
    };
  }

  /**
   * 4. Active Cloudflare Stream Sync:
   *    Polls Cloudflare Stream API to check if transcoding is complete,
   *    updating the database without waiting for webhooks.
   */
  async syncStreamStatus(
    recordingId: string,
  ): Promise<CloudflarePlaybackResponseDto> {
    const recording = await this.recordingRepo.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException(`Recording ${recordingId} not found`);
    }

    const meta = (recording.metadata ?? {}) as Record<string, any>;
    const cfUid = meta.cloudflareStreamUid || recording.mux_playback_id;

    if (cfUid && meta.cloudflareStreamStatus !== 'ready') {
      try {
        const asset = await this.vodAdapter.getAsset(cfUid);
        if (asset.status === 'ready') {
          await this.recordingRepo.update(recording.id, {
            mux_playback_id: cfUid,
            mux_media_url: asset.playbackUrl,
            status: 'ready',
            metadata: {
              ...meta,
              cloudflareStreamStatus: 'ready',
              cloudflarePlaybackUrl: asset.playbackUrl,
              cloudflareReadyAt: new Date().toISOString(),
            } as any,
          });
          this.logger.log(
            `Active sync: Cloudflare Stream UID ${cfUid} is ready! Updated DB.`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `Active sync failed for ${recordingId}: ${err?.message}`,
        );
      }
    }

    return this.getPlayback(recordingId);
  }

  /**
   * 5. Start Cloudflare Live Stream:
   *    Creates Cloudflare live input, commands Pi to stream RTSP feed to Cloudflare via RTMPS.
   */
  async startLiveStream(dto: CloudflareStartLiveStreamDto): Promise<{
    success: boolean;
    cameraId: string;
    courtNumber: number;
    channel: number;
    liveStreamId: string;
    playbackUrl: string;
    isLive: boolean;
    warning?: string;
  }> {
    const camera = await this.cameraRepo.findOne({
      where: { id: dto.cameraId },
    });

    if (!camera || !camera.raspberryPiBaseUrl) {
      throw new BadRequestException(
        'Camera not found or Pi gateway URL missing',
      );
    }

    const channelNumber = dto.channel ?? camera.court_number ?? 1;
    const courtNumber = dto.courtNumber ?? camera.court_number ?? channelNumber;

    // 1. Create Live Input in Cloudflare Stream
    const liveOutput = await this.liveAdapter.createLiveStream({
      courtNumber,
      channel: channelNumber,
      cameraId: camera.id,
      name: dto.name || `Court ${courtNumber} Live Stream`,
      tournamentId: dto.tournamentId,
      turfId: camera.turfId,
    });

    // 2. Command Pi to relay RTSP from venue NVR to Cloudflare RTMPS
    let warning: string | undefined;
    try {
      await this.piApiService.startLiveStream(
        camera.raspberryPiBaseUrl,
        {
          channel: channelNumber,
          rtmpUrl: liveOutput.rtmpUrl,
        },
        camera.raspberryPiApiKey,
      );
    } catch (err: any) {
      const detail = err?.response?.message || err?.message || 'Pi unreachable';
      warning = `Cloudflare live input provisioned, but Pi relay reported: ${detail}`;
      this.logger.warn(`Start live stream Pi warning: ${detail}`);
    }

    // 3. Link stream to tournaments if tournamentId is given or auto-match
    try {
      const activeTournaments = dto.tournamentId
        ? await this.tournamentRepo.find({ where: { id: dto.tournamentId } })
        : await this.dataSource.query(
            `SELECT id, "liveStreams" FROM tournaments WHERE "cameraIds"::text LIKE $1 AND status IN ('Upcoming', 'Live')`,
            [`%${camera.id}%`],
          );

      const logicalSlot = resolveLiveStreamSlot({
        nvrChannel: channelNumber,
        courtNumber,
        raspberryPiBaseUrl: camera.raspberryPiBaseUrl,
      });
      const actualCameraId = liveStreamCameraId(camera.id, logicalSlot);

      for (const t of activeTournaments) {
        const streams = upsertTournamentLiveStream(t.liveStreams || [], {
          cameraId: actualCameraId,
          cameraName: `${camera.name || 'Camera'} (Court ${courtNumber})`,
          courtNumber,
          playbackUrl: liveOutput.playbackUrl,
          liveStreamId: liveOutput.providerLiveStreamId,
          isLive: true,
        });

        await this.tournamentRepo.update(t.id, {
          liveStreams: streams as any,
        });
      }
    } catch (tErr: any) {
      this.logger.warn(
        `Failed to update tournament live streams: ${tErr?.message}`,
      );
    }

    return {
      success: true,
      cameraId: camera.id,
      courtNumber,
      channel: channelNumber,
      liveStreamId: liveOutput.providerLiveStreamId,
      playbackUrl: liveOutput.playbackUrl,
      isLive: true,
      warning,
    };
  }

  /**
   * 6. Stop Cloudflare Live Stream
   */
  async stopLiveStream(
    dto: CloudflareStopLiveStreamDto,
  ): Promise<{ success: boolean; message: string }> {
    const camera = await this.cameraRepo.findOne({
      where: { id: dto.cameraId },
    });

    if (camera?.raspberryPiBaseUrl) {
      try {
        await this.piApiService.stopLiveStream(
          camera.raspberryPiBaseUrl,
          { channel: dto.channel ?? camera.court_number ?? 1 },
          camera.raspberryPiApiKey,
        );
      } catch (err: any) {
        this.logger.warn(`Stop live stream Pi warning: ${err?.message}`);
      }
    }

    if (dto.liveInputId) {
      try {
        await this.liveAdapter.stopLiveStream(dto.liveInputId);
      } catch (cfErr: any) {
        this.logger.warn(
          `Stop Cloudflare live input warning: ${cfErr?.message}`,
        );
      }
    }

    return {
      success: true,
      message: 'Cloudflare live stream stopped successfully',
    };
  }

  /**
   * 7. Create Highlight Clip in Cloudflare Stream
   */
  async createHighlightClip(dto: CloudflareCreateClipDto): Promise<{
    highlightId: string;
    clipAssetId: string;
    playbackUrl: string;
    status: string;
  }> {
    const recording = await this.recordingRepo.findOne({
      where: { id: dto.recordingId },
    });

    if (!recording) {
      throw new NotFoundException(`Recording ${dto.recordingId} not found`);
    }

    const meta = (recording.metadata ?? {}) as Record<string, any>;
    const parentUid = meta.cloudflareStreamUid || recording.mux_playback_id;

    if (!parentUid) {
      throw new BadRequestException(
        `Recording ${dto.recordingId} has not been ingested into Cloudflare Stream yet`,
      );
    }

    const clip = await this.vodAdapter.createClip({
      parentAssetId: parentUid,
      startTimeSeconds: dto.startTimeSeconds,
      endTimeSeconds: dto.endTimeSeconds,
      passthrough: dto.recordingId,
    });

    const highlight = this.highlightRepo.create({
      id: uuidv4(),
      recordingId: recording.id,
      asset_id: clip.clipAssetId,
      playback_id: clip.playbackId,
      mux_public_playback_url: clip.playbackUrl,
      status: clip.status === 'ready' ? 'ready' : 'processing',
      isClipCreated: true,
      button_click_timestamp: new Date(),
    });

    await this.highlightRepo.save(highlight);

    return {
      highlightId: highlight.id,
      clipAssetId: clip.clipAssetId,
      playbackUrl: clip.playbackUrl,
      status: clip.status,
    };
  }
}
