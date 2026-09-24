import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recording } from '../../recording/entities/recording.entity';
import { RecordingHighlights } from '../../recording/entities/recording-highlights.entity';
import { PaymentRestrictionService } from '../../payment/payment-restriction.service';
import { CloudflarePlaybackTokenService } from './cloudflare-playback-token.service';
import { MediaFeatureFlagsService } from './media-feature-flags.service';
import { MuxService } from '../../mux/mux.service';
import {
  IPlaybackAuthorizationService,
  PlaybackGrant,
} from '../interfaces/playback-authorization.interface';
import { MediaAssetStateMachine } from '../state-machines/media-state-machine';

@Injectable()
export class MediaPlaybackAuthorizationService implements IPlaybackAuthorizationService {
  private readonly logger = new Logger(MediaPlaybackAuthorizationService.name);

  constructor(
    private readonly cloudflareTokenService: CloudflarePlaybackTokenService,
    private readonly featureFlagsService: MediaFeatureFlagsService,
    @Optional()
    @InjectRepository(Recording)
    private readonly recordingRepository?: Repository<Recording>,
    @Optional()
    @InjectRepository(RecordingHighlights)
    private readonly highlightRepository?: Repository<RecordingHighlights>,
    @Optional()
    private readonly paymentRestrictionService?: PaymentRestrictionService,
    @Optional()
    private readonly muxService?: MuxService,
  ) {}

  /**
   * Evaluates user authorization, asset state, and issues a short-lived PlaybackGrant for a recording.
   */
  async getRecordingPlaybackGrant(
    recordingId: string,
    userId: string,
    ttlSeconds = 21600,
  ): Promise<PlaybackGrant> {
    this.logger.log(
      `Authorizing recording playback: ${recordingId} for user: ${userId}`,
    );

    if (!this.recordingRepository) {
      throw new Error('Recording repository is not available');
    }

    const recording = await this.recordingRepository.findOne({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException(`Recording ${recordingId} not found`);
    }

    // 1. Validate asset state
    const normalizedState = this.normalizeState(recording.status);
    if (
      !MediaAssetStateMachine.isPlayable(normalizedState as any) &&
      recording.status !== 'ready'
    ) {
      throw new BadRequestException(
        `Recording is not playable (current state: ${recording.status || 'unknown'})`,
      );
    }

    // 2. Enforce entitlement (Owner or Paid)
    const isOwner = recording.userId === userId;
    let hasPaidAccess = isOwner;

    if (!isOwner && this.paymentRestrictionService) {
      const accessCheck =
        await this.paymentRestrictionService.checkRecordingAccess(
          userId,
          recordingId,
        );
      if (accessCheck.paymentRequired && !accessCheck.canAccess) {
        throw new ForbiddenException(
          'Payment is required to view this recording',
        );
      }
      hasPaidAccess = accessCheck.canAccess;
    }

    // 3. Determine provider
    const isCloudflare =
      recording.metadata?.provider === 'cloudflare' ||
      this.featureFlagsService.getVodProvider() === 'cloudflare' ||
      !!recording.metadata?.cloudflareStreamUid;

    if (isCloudflare) {
      const assetUid =
        recording.metadata?.cloudflareStreamUid ||
        recording.mux_playback_id ||
        recording.id;

      const { token, expiresAt } =
        await this.cloudflareTokenService.generateSignedToken(
          assetUid,
          ttlSeconds,
        );

      const playbackUrl = this.cloudflareTokenService.getSignedPlaybackUrl(
        assetUid,
        token,
      );
      const thumbnailUrl = this.cloudflareTokenService.getSignedThumbnailUrl(
        assetUid,
        token,
      );

      return {
        assetId: recording.id,
        playbackId: assetUid,
        provider: 'cloudflare',
        playbackUrl,
        thumbnailUrl,
        signedToken: token,
        expiresAt,
        isPublic: false,
        hasPaidAccess,
      };
    }

    // Legacy Mux path
    const playbackId = recording.mux_playback_id || recording.id;
    let signedToken: string | null = null;
    let expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    if (this.muxService) {
      const signed = await this.muxService.signPlaybackToken(
        playbackId,
        ttlSeconds,
      );
      if (signed) {
        signedToken = signed.token;
        expiresAt = signed.expires_at;
      }
    }

    const publicUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    const playbackUrl = signedToken
      ? `${publicUrl}?token=${encodeURIComponent(signedToken)}`
      : publicUrl;

    return {
      assetId: recording.id,
      playbackId,
      provider: 'mux',
      playbackUrl,
      thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg`,
      signedToken,
      expiresAt,
      isPublic: false,
      hasPaidAccess,
    };
  }

  /**
   * Evaluates user authorization, asset state, and issues a short-lived PlaybackGrant for a highlight clip.
   */
  async getHighlightPlaybackGrant(
    highlightId: string,
    userId: string,
    ttlSeconds = 21600,
  ): Promise<PlaybackGrant> {
    this.logger.log(
      `Authorizing highlight playback: ${highlightId} for user: ${userId}`,
    );

    if (!this.highlightRepository) {
      throw new Error('Highlight repository is not available');
    }

    const highlight = await this.highlightRepository.findOne({
      where: { id: highlightId },
      relations: ['recording'],
    });

    if (!highlight) {
      throw new NotFoundException(`Highlight ${highlightId} not found`);
    }

    // 1. Validate asset state
    const normalizedState = this.normalizeState(highlight.status);
    if (
      !MediaAssetStateMachine.isPlayable(normalizedState as any) &&
      highlight.status !== 'ready'
    ) {
      throw new BadRequestException(
        `Highlight is not playable (current state: ${highlight.status || 'unknown'})`,
      );
    }

    // 2. Enforce entitlement via parent recording
    let hasPaidAccess = true;
    if (
      highlight.recording &&
      highlight.recording.userId !== userId &&
      this.paymentRestrictionService
    ) {
      const accessCheck =
        await this.paymentRestrictionService.checkRecordingAccess(
          userId,
          highlight.recordingId,
        );
      if (accessCheck.paymentRequired && !accessCheck.canAccess) {
        throw new ForbiddenException(
          'Payment is required to view this highlight clip',
        );
      }
      hasPaidAccess = accessCheck.canAccess;
    }

    // 3. Determine provider
    const highlightMeta = (highlight.metadata as any) || {};
    const isCloudflare =
      highlightMeta.provider === 'cloudflare' ||
      this.featureFlagsService.getVodProvider() === 'cloudflare' ||
      !!highlightMeta.cloudflareStreamUid;

    const playbackId =
      highlightMeta.cloudflareStreamUid ||
      highlight.playback_id ||
      highlight.id;

    if (isCloudflare) {
      const { token, expiresAt } =
        await this.cloudflareTokenService.generateSignedToken(
          playbackId,
          ttlSeconds,
        );

      const playbackUrl = this.cloudflareTokenService.getSignedPlaybackUrl(
        playbackId,
        token,
      );
      const thumbnailUrl = this.cloudflareTokenService.getSignedThumbnailUrl(
        playbackId,
        token,
      );

      return {
        assetId: highlight.id,
        playbackId,
        provider: 'cloudflare',
        playbackUrl,
        thumbnailUrl,
        signedToken: token,
        expiresAt,
        isPublic: false,
        hasPaidAccess,
      };
    }

    // Legacy Mux path
    let signedToken: string | null = null;
    let expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    if (this.muxService && playbackId) {
      const signed = await this.muxService.signPlaybackToken(
        playbackId,
        ttlSeconds,
      );
      if (signed) {
        signedToken = signed.token;
        expiresAt = signed.expires_at;
      }
    }

    const publicUrl =
      highlight.mux_public_playback_url ||
      `https://stream.mux.com/${playbackId}.m3u8`;
    const playbackUrl = signedToken
      ? `${publicUrl}?token=${encodeURIComponent(signedToken)}`
      : publicUrl;

    return {
      assetId: highlight.id,
      playbackId,
      provider: 'mux',
      playbackUrl,
      thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg`,
      signedToken,
      expiresAt,
      isPublic: false,
      hasPaidAccess,
    };
  }

  private normalizeState(status?: string): string {
    const s = String(status || '').toUpperCase();
    if (s === 'READY' || s === 'COMPLETED') return 'READY';
    if (s === 'PROCESSING' || s === 'IN_PROGRESS' || s === 'UPLOADING')
      return 'PROCESSING';
    if (s === 'FAILED' || s === 'PERMANENTLY_FAILED' || s === 'ERROR')
      return 'FAILED';
    return s || 'CREATED';
  }
}
