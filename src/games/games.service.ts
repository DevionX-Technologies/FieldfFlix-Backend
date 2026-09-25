import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { GameEntity } from './entities/game.entity';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { ExtractMatchDto } from './dto/extract-match.dto';
import { RecordingService } from '../recording/service/recording.service';
import { MediaProviderFactory } from '../media-provider/services/media-provider-factory.service';
import { CloudflarePlaybackTokenService } from '../media-provider/services/cloudflare-playback-token.service';

/**
 * GamesService
 *
 * Manages game/match entries that link tournament fixtures to recordings.
 *
 * A "game" in FieldFlicks represents a single match played at a court during
 * a tournament. It supports:
 * 1. CRUD and status lifecycle (scheduled -> live -> completed | cancelled)
 * 2. On-demand match extraction directly from court NVR cameras
 * 3. Dual-path playback:
 *    - Direct R2 playback immediately when video reaches R2 (zero wait for stream encoding)
 *    - Cloudflare Stream VOD adaptive HLS playback once ready
 *    - Direct R2 MP4 download URL
 */
@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(
    @InjectRepository(GameEntity)
    private readonly gameRepo: Repository<GameEntity>,
    @Inject(forwardRef(() => RecordingService))
    private readonly recordingService: RecordingService,
    @Optional()
    private readonly mediaProviderFactory?: MediaProviderFactory,
    @Optional()
    private readonly cfPlaybackTokenService?: CloudflarePlaybackTokenService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(dto: CreateGameDto, createdBy?: string): Promise<GameEntity> {
    const game = this.gameRepo.create({
      ...dto,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      status: dto.status ?? 'scheduled',
      createdBy: createdBy ?? null,
    });
    const saved = await this.gameRepo.save(game);
    this.logger.log(
      `Game created: id=${saved.id} tournament=${saved.tournamentId}`,
    );
    return saved;
  }

  async findByTournament(
    tournamentId: string,
    options?: { status?: string; courtNumber?: number },
  ): Promise<GameEntity[]> {
    const where: Record<string, unknown> = { tournamentId };
    if (options?.status) where.status = options.status;
    if (options?.courtNumber != null) where.courtNumber = options.courtNumber;

    return this.gameRepo.find({
      where,
      order: { scheduledAt: 'ASC', createdAt: 'ASC' },
    } as FindManyOptions<GameEntity>);
  }

  async findOne(id: string): Promise<GameEntity> {
    const game = await this.gameRepo.findOne({ where: { id } });
    if (!game) throw new NotFoundException(`Game ${id} not found`);
    return game;
  }

  async update(id: string, dto: UpdateGameDto): Promise<GameEntity> {
    const game = await this.findOne(id);
    Object.assign(game, {
      ...dto,
      scheduledAt: dto.scheduledAt
        ? new Date(dto.scheduledAt)
        : game.scheduledAt,
    });
    return this.gameRepo.save(game);
  }

  async remove(id: string): Promise<void> {
    const game = await this.findOne(id);
    await this.gameRepo.remove(game);
    this.logger.log(`Game deleted: id=${id}`);
  }

  // ─── Recording linkage ─────────────────────────────────────────────────────

  /**
   * Link a recording to a game.
   * Called from RecordingService or admin when a recording is available.
   * Safe to call multiple times (idempotent).
   */
  async linkRecording(
    gameId: string,
    recordingId: string,
  ): Promise<GameEntity> {
    const game = await this.findOne(gameId);
    if (game.recordingId && game.recordingId !== recordingId) {
      this.logger.warn(
        `Game ${gameId} already has recording ${game.recordingId}; overwriting with ${recordingId}`,
      );
    }
    game.recordingId = recordingId;
    return this.gameRepo.save(game);
  }

  // ─── Match Extraction ──────────────────────────────────────────────────────

  /**
   * Trigger on-demand match video extraction for this game from venue NVR / court camera.
   * Automatically attaches the resulting recording to the game.
   */
  async extractMatch(
    gameId: string,
    dto: Partial<ExtractMatchDto>,
    userId?: string,
  ): Promise<{
    gameId: string;
    recordingId: string;
    status: string;
    message: string;
  }> {
    const game = await this.findOne(gameId);

    const startTime =
      dto.startTime ||
      game.scheduledAt?.toISOString() ||
      game.startedAt?.toISOString();
    const endTime =
      dto.endTime ||
      game.endedAt?.toISOString() ||
      (startTime
        ? new Date(new Date(startTime).getTime() + 3600000).toISOString()
        : undefined);

    if (!startTime || !endTime) {
      throw new BadRequestException(
        'startTime and endTime are required for match extraction',
      );
    }

    const extractionResult = await this.recordingService.extractMatchVideo({
      gameId: game.id,
      tournamentId: game.tournamentId,
      courtNumber: dto.courtNumber ?? game.courtNumber ?? undefined,
      cameraId: dto.cameraId ?? game.cameraId ?? undefined,
      startTime,
      endTime,
      userId: userId || game.createdBy || undefined,
      title:
        dto.title ||
        `Match: ${game.teamA || 'Team A'} vs ${game.teamB || 'Team B'} (Game ${game.id})`,
      metadata: {
        gameId: game.id,
        tournamentId: game.tournamentId,
        round: game.round,
        teamA: game.teamA,
        teamB: game.teamB,
        score: game.score,
        ...dto.metadata,
      },
    });

    game.recordingId = extractionResult.recordingId;
    if (game.status === 'scheduled') {
      game.status = 'live';
      game.startedAt = new Date();
    }
    await this.gameRepo.save(game);

    return {
      gameId: game.id,
      recordingId: extractionResult.recordingId,
      status: extractionResult.status,
      message:
        'Match extraction requested. Direct R2 playback will be available as soon as upload finishes; Cloudflare Stream HLS will follow in background.',
    };
  }

  // ─── Playback & Download Resolution ────────────────────────────────────────

  /**
   * Get dual playback URLs for a game:
   * 1. direct_playback_url: Presigned GET to R2 (playable immediately!)
   * 2. stream_playback_url: Cloudflare Stream adaptive HLS manifest (when ready)
   * 3. download_url: Direct download URL from R2
   */
  async getPlayback(gameId: string): Promise<{
    assetId?: string | null;
    matchId?: string | null;
    angleId?: string | null;
    status: string;
    preferredProvider?: string;
    activeProvider?: string;
    fallbackAvailable?: boolean;
    r2?: {
      available: boolean;
      playbackType: string;
      url: string | null;
      expiresAt: string | null;
    };
    stream?: {
      available: boolean;
      videoUid: string | null;
      playbackToken: string | null;
      manifestUrl: string | null;
    };
    durationMs?: number;
    mediaStartOffsetMs?: number;
    updatedAt?: string;

    gameId: string;
    recordingId: string | null;
    is_direct_ready: boolean;
    is_stream_ready: boolean;
    playable: boolean;
    direct_playback_url: string | null;
    r2_playback_url: string | null;
    stream_playback_url: string | null;
    download_url: string | null;
    signed_url: string | null;
  }> {
    const game = await this.findOne(gameId);

    if (!game.recordingId) {
      return {
        assetId: null,
        matchId: game.id,
        angleId: game.courtNumber ? String(game.courtNumber) : null,
        status: game.status,
        preferredProvider: 'STREAM',
        activeProvider: 'NONE',
        fallbackAvailable: false,
        r2: {
          available: false,
          playbackType: 'PROGRESSIVE',
          url: null,
          expiresAt: null,
        },
        stream: {
          available: false,
          videoUid: null,
          playbackToken: null,
          manifestUrl: null,
        },
        durationMs: 0,
        mediaStartOffsetMs: 0,
        updatedAt:
          (game as any).updated_at instanceof Date
            ? (game as any).updated_at.toISOString()
            : new Date().toISOString(),

        gameId: game.id,
        recordingId: null,
        is_direct_ready: false,
        is_stream_ready: false,
        playable: false,
        direct_playback_url: null,
        r2_playback_url: null,
        stream_playback_url: null,
        download_url: null,
        signed_url: null,
      };
    }

    const recording = await this.recordingService.getRecordingById(
      game.recordingId,
    );
    if (!recording) {
      throw new NotFoundException(
        `Recording ${game.recordingId} linked to game not found`,
      );
    }

    // Direct R2 Playback & Download
    let directUrl: string | null = null;
    let isDirectReady = false;

    if (recording.s3Path) {
      try {
        const s3Clean = recording.s3Path.replace(/^(s3|r2):\/\//, '');
        const firstSlash = s3Clean.indexOf('/');
        const bucket =
          firstSlash > 0 ? s3Clean.substring(0, firstSlash) : undefined;
        const key =
          firstSlash > 0 ? s3Clean.substring(firstSlash + 1) : s3Clean;

        if (this.mediaProviderFactory) {
          const storageProvider =
            this.mediaProviderFactory.getStorageProvider();
          const object = await storageProvider.headObject(key, bucket);
          if (!object || object.sizeBytes <= 0) {
            throw new NotFoundException(
              `R2 object for game ${gameId} was not found or was empty`,
            );
          }
          const downloadOutput =
            await storageProvider.generateDownloadPresignedUrl({
              key,
              bucket,
              expiresInSeconds: 21600, // 6 hours
            });
          directUrl = downloadOutput.downloadUrl;
          isDirectReady = true;
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to resolve R2 presigned URL for game ${gameId}: ${err.message}`,
        );
      }
    }

    // Cloudflare Stream HLS Playback
    let streamUrl: string | null = null;
    let isStreamReady = false;
    const recMeta = (recording.metadata as any) || {};
    const cfUid =
      recMeta.cloudflareStreamUid ||
      (recMeta.provider === 'cloudflare' ? recMeta.playbackId : null);

    if (cfUid) {
      streamUrl = `https://videodelivery.net/${cfUid}/manifest/video.m3u8`;
      if (this.cfPlaybackTokenService) {
        try {
          const tokenRes =
            await this.cfPlaybackTokenService.generateSignedToken(cfUid, 21600);
          streamUrl = `https://videodelivery.net/${tokenRes.token}/manifest/video.m3u8`;
        } catch (e: any) {
          this.logger.warn(`Stream token generation failed: ${e.message}`);
        }
      }
      isStreamReady = recMeta.cloudflareStreamStatus
        ? recMeta.cloudflareStreamStatus === 'ready'
        : recording.status === 'ready' || recording.status === 'completed';
    } else if (recording.mux_playback_id) {
      streamUrl =
        recording.mux_media_url ||
        `https://stream.mux.com/${recording.mux_playback_id}.m3u8`;
      isStreamReady =
        recording.status === 'ready' || recording.status === 'completed';
    }

    const playable = isDirectReady || isStreamReady;
    // Prefer streamUrl for adaptive quality if ready, fallback to direct MP4 R2 url
    const primaryUrl = isStreamReady && streamUrl ? streamUrl : directUrl;

    let canonicalStatus = 'CREATED';
    const recStatus = String(recording.status || '').toLowerCase();
    if (
      recStatus === 'failed' ||
      recStatus === 'cancelled' ||
      recStatus === 'interrupted'
    ) {
      canonicalStatus = 'FAILED';
    } else if (isStreamReady) {
      canonicalStatus = 'STREAM_READY';
    } else if (isDirectReady) {
      canonicalStatus = 'R2_READY';
    } else if (recStatus === 'extracting' || recStatus === 'uploading') {
      canonicalStatus = 'UPLOADING';
    } else if (recStatus === 'ready' || recStatus === 'completed') {
      canonicalStatus = 'READY';
    }

    const preferredProvider = 'STREAM';
    const activeProvider = isStreamReady
      ? 'STREAM'
      : isDirectReady
        ? 'R2'
        : 'NONE';

    const durationSeconds =
      typeof (recording as any).duration === 'number'
        ? (recording as any).duration
        : typeof recMeta.duration === 'number'
          ? recMeta.duration
          : 0;
    const durationMs = Math.round(durationSeconds * 1000);
    const r2ExpiresAtIso = new Date(Date.now() + 21600 * 1000).toISOString();
    const recUpdatedAt =
      (recording as any).updated_at instanceof Date
        ? (recording as any).updated_at.toISOString()
        : new Date().toISOString();

    return {
      // Canonical Media Platform Lifecycle Contract:
      assetId: recording.id,
      matchId: game.id,
      angleId: game.courtNumber ? String(game.courtNumber) : null,
      status: canonicalStatus,
      preferredProvider,
      activeProvider,
      fallbackAvailable: Boolean(isDirectReady && isStreamReady),
      r2: {
        available: isDirectReady,
        playbackType: 'PROGRESSIVE',
        url: directUrl,
        expiresAt: r2ExpiresAtIso,
      },
      stream: {
        available: isStreamReady,
        videoUid: cfUid || null,
        playbackToken: null,
        manifestUrl: streamUrl,
      },
      durationMs,
      mediaStartOffsetMs: 0,
      updatedAt: recUpdatedAt,

      // Backward-compatible fields:
      gameId: game.id,
      recordingId: recording.id,
      is_direct_ready: isDirectReady,
      is_stream_ready: isStreamReady,
      playable,
      direct_playback_url: directUrl,
      r2_playback_url: directUrl,
      stream_playback_url: streamUrl,
      download_url: directUrl,
      signed_url: primaryUrl,
    };
  }

  /**
   * Get direct download URL for game match footage (MP4 from R2).
   */
  async getDownloadUrl(
    gameId: string,
  ): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const playback = await this.getPlayback(gameId);
    if (!playback.download_url) {
      throw new NotFoundException(
        `No downloadable media available for game ${gameId}`,
      );
    }
    return {
      downloadUrl: playback.download_url,
      expiresInSeconds: 21600,
    };
  }

  // ─── Status transitions ────────────────────────────────────────────────────

  async markLive(id: string): Promise<GameEntity> {
    return this._transition(id, 'live', { startedAt: new Date() });
  }

  async markCompleted(id: string, score?: string): Promise<GameEntity> {
    return this._transition(id, 'completed', {
      endedAt: new Date(),
      ...(score ? { score } : {}),
    });
  }

  async markCancelled(id: string): Promise<GameEntity> {
    return this._transition(id, 'cancelled', { endedAt: new Date() });
  }

  private async _transition(
    id: string,
    newStatus: GameEntity['status'],
    extra: Partial<GameEntity>,
  ): Promise<GameEntity> {
    const game = await this.findOne(id);
    const validTransitions: Record<
      GameEntity['status'],
      GameEntity['status'][]
    > = {
      scheduled: ['live', 'cancelled'],
      live: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };
    if (!validTransitions[game.status].includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition game from '${game.status}' to '${newStatus}'`,
      );
    }
    Object.assign(game, { status: newStatus, ...extra });
    const saved = await this.gameRepo.save(game);
    this.logger.log(`Game ${id} → ${newStatus}`);
    return saved;
  }
}
