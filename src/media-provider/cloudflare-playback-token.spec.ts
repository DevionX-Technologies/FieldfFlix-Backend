import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { CloudflarePlaybackTokenService } from './services/cloudflare-playback-token.service';
import { MediaPlaybackAuthorizationService } from './services/media-playback-authorization.service';
import { MediaPlaybackController } from './controllers/media-playback.controller';
import { MediaFeatureFlagsService } from './services/media-feature-flags.service';

describe('Cloudflare Playback Token & Authorization', () => {
  describe('CloudflarePlaybackTokenService', () => {
    let service: CloudflarePlaybackTokenService;
    const testSecret = 'cf-test-signing-secret-987';

    beforeEach(() => {
      process.env.CLOUDFLARE_STREAM_SIGNING_SECRET = testSecret;
      service = new CloudflarePlaybackTokenService();
    });

    afterEach(() => {
      delete process.env.CLOUDFLARE_STREAM_SIGNING_SECRET;
    });

    it('generates a valid signed token for an asset', async () => {
      const assetUid = 'video_uid_abc_123';
      const ttl = 3600; // 1 hour
      const { token, expiresAt } = await service.generateSignedToken(
        assetUid,
        ttl,
      );

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Verify token payload
      const payload = await service.verifySignedToken(
        token,
        assetUid,
        undefined,
        testSecret,
      );
      expect(payload.sub).toBe(assetUid);
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('rejects an expired token with UnauthorizedException', async () => {
      const assetUid = 'video_uid_expired';
      const now = Math.floor(Date.now() / 1000);
      const expiredTime = now - 500;

      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: assetUid, exp: expiredTime }),
      ).toString('base64url');
      const signature = crypto
        .createHmac('sha256', testSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      const expiredToken = `${header}.${payload}.${signature}`;

      await expect(
        service.verifySignedToken(
          expiredToken,
          assetUid,
          undefined,
          testSecret,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a tampered signature with UnauthorizedException', async () => {
      const assetUid = 'video_uid_tampered';
      const { token } = await service.generateSignedToken(assetUid, 3600);
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature_bytes`;

      await expect(
        service.verifySignedToken(
          tamperedToken,
          assetUid,
          undefined,
          testSecret,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an asset mismatch with UnauthorizedException', async () => {
      const assetUid = 'video_uid_asset1';
      const wrongAssetUid = 'video_uid_asset2';
      const { token } = await service.generateSignedToken(assetUid, 3600);

      await expect(
        service.verifySignedToken(token, wrongAssetUid, undefined, testSecret),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('constructs correct HLS manifest and poster URLs for public and signed tokens', () => {
      const assetUid = 'cf_asset_555';
      const token = 'token_xyz_888';

      // Signed URLs
      const signedHls = service.getSignedPlaybackUrl(assetUid, token);
      expect(signedHls).toBe(
        `https://videodelivery.net/${token}/manifest/video.m3u8`,
      );

      const signedThumb = service.getSignedThumbnailUrl(assetUid, token);
      expect(signedThumb).toBe(
        `https://videodelivery.net/${token}/thumbnails/thumbnail.jpg`,
      );

      // Public URLs
      const publicHls = service.getSignedPlaybackUrl(assetUid, null);
      expect(publicHls).toBe(
        `https://videodelivery.net/${assetUid}/manifest/video.m3u8`,
      );

      const publicThumb = service.getSignedThumbnailUrl(assetUid, null);
      expect(publicThumb).toBe(
        `https://videodelivery.net/${assetUid}/thumbnails/thumbnail.jpg`,
      );
    });
  });

  describe('MediaPlaybackAuthorizationService', () => {
    let authService: MediaPlaybackAuthorizationService;
    let tokenService: CloudflarePlaybackTokenService;
    let flagsService: MediaFeatureFlagsService;
    let mockRecordingRepo: any;
    let mockHighlightRepo: any;
    let mockPaymentService: any;

    beforeEach(() => {
      process.env.CLOUDFLARE_STREAM_SIGNING_SECRET =
        'cf-test-signing-secret-987';
      tokenService = new CloudflarePlaybackTokenService();
      flagsService = new MediaFeatureFlagsService();

      mockRecordingRepo = {
        findOne: jest.fn(),
      };
      mockHighlightRepo = {
        findOne: jest.fn(),
      };
      mockPaymentService = {
        checkRecordingAccess: jest.fn(),
      };

      authService = new MediaPlaybackAuthorizationService(
        tokenService,
        flagsService,
        mockRecordingRepo,
        mockHighlightRepo,
        mockPaymentService,
      );
    });

    afterEach(() => {
      delete process.env.CLOUDFLARE_STREAM_SIGNING_SECRET;
    });

    it('grants playback to recording owner directly without payment check', async () => {
      const ownerId = 'user_owner_1';
      const recordingId = 'rec_101';
      mockRecordingRepo.findOne.mockResolvedValue({
        id: recordingId,
        userId: ownerId,
        status: 'ready',
        metadata: {
          provider: 'cloudflare',
          cloudflareStreamUid: 'cf_stream_101',
        },
      });

      const grant = await authService.getRecordingPlaybackGrant(
        recordingId,
        ownerId,
      );

      expect(grant).toBeDefined();
      expect(grant.assetId).toBe(recordingId);
      expect(grant.provider).toBe('cloudflare');
      expect(grant.hasPaidAccess).toBe(true);
      expect(grant.playbackUrl).toContain('https://videodelivery.net/');
      expect(mockPaymentService.checkRecordingAccess).not.toHaveBeenCalled();
    });

    it('grants playback to non-owner if payment access is confirmed', async () => {
      const ownerId = 'user_owner_1';
      const viewerId = 'user_viewer_2';
      const recordingId = 'rec_102';

      mockRecordingRepo.findOne.mockResolvedValue({
        id: recordingId,
        userId: ownerId,
        status: 'ready',
        metadata: {
          provider: 'cloudflare',
          cloudflareStreamUid: 'cf_stream_102',
        },
      });

      mockPaymentService.checkRecordingAccess.mockResolvedValue({
        canAccess: true,
        paymentRequired: true,
      });

      const grant = await authService.getRecordingPlaybackGrant(
        recordingId,
        viewerId,
      );

      expect(grant).toBeDefined();
      expect(grant.hasPaidAccess).toBe(true);
      expect(mockPaymentService.checkRecordingAccess).toHaveBeenCalledWith(
        viewerId,
        recordingId,
      );
    });

    it('throws ForbiddenException for non-owner when payment is required and unpaid', async () => {
      const ownerId = 'user_owner_1';
      const viewerId = 'user_unpaid_3';
      const recordingId = 'rec_103';

      mockRecordingRepo.findOne.mockResolvedValue({
        id: recordingId,
        userId: ownerId,
        status: 'ready',
      });

      mockPaymentService.checkRecordingAccess.mockResolvedValue({
        canAccess: false,
        paymentRequired: true,
      });

      await expect(
        authService.getRecordingPlaybackGrant(recordingId, viewerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if recording is in failed or unplayable state', async () => {
      const recordingId = 'rec_104';
      mockRecordingRepo.findOne.mockResolvedValue({
        id: recordingId,
        userId: 'user_1',
        status: 'failed',
      });

      await expect(
        authService.getRecordingPlaybackGrant(recordingId, 'user_1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if recording does not exist', async () => {
      mockRecordingRepo.findOne.mockResolvedValue(null);

      await expect(
        authService.getRecordingPlaybackGrant('nonexistent_id', 'user_1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('grants highlight clip playback successfully', async () => {
      const highlightId = 'hl_201';
      const ownerId = 'user_owner_1';

      mockHighlightRepo.findOne.mockResolvedValue({
        id: highlightId,
        recordingId: 'rec_parent_1',
        status: 'ready',
        playback_id: 'cf_hl_stream_201',
        metadata: { provider: 'cloudflare' },
        recording: { id: 'rec_parent_1', userId: ownerId },
      });

      const grant = await authService.getHighlightPlaybackGrant(
        highlightId,
        ownerId,
      );

      expect(grant).toBeDefined();
      expect(grant.assetId).toBe(highlightId);
      expect(grant.provider).toBe('cloudflare');
      expect(grant.playbackUrl).toContain('https://videodelivery.net/');
    });
  });

  describe('MediaPlaybackController', () => {
    let controller: MediaPlaybackController;
    let authService: any;

    beforeEach(() => {
      authService = {
        getRecordingPlaybackGrant: jest.fn(),
        getHighlightPlaybackGrant: jest.fn(),
      };
      controller = new MediaPlaybackController(authService);
    });

    it('returns recording playback grant on GET :recordingId/grant', async () => {
      const mockGrant = {
        assetId: 'rec_999',
        playbackId: 'stream_999',
        provider: 'cloudflare',
        playbackUrl: 'https://videodelivery.net/token/manifest/video.m3u8',
        expiresAt: new Date(),
        isPublic: false,
        hasPaidAccess: true,
      };
      authService.getRecordingPlaybackGrant.mockResolvedValue(mockGrant);

      const req: any = { user: { id: 'test_user_id' } };
      const res = await controller.getRecordingPlaybackGrant(
        req,
        'rec_999',
        '7200',
      );

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockGrant);
      expect(authService.getRecordingPlaybackGrant).toHaveBeenCalledWith(
        'rec_999',
        'test_user_id',
        7200,
      );
    });

    it('returns highlight clip playback grant on GET highlight/:highlightId/grant', async () => {
      const mockGrant = {
        assetId: 'hl_888',
        playbackId: 'stream_888',
        provider: 'cloudflare',
        playbackUrl: 'https://videodelivery.net/token_hl/manifest/video.m3u8',
        expiresAt: new Date(),
        isPublic: false,
        hasPaidAccess: true,
      };
      authService.getHighlightPlaybackGrant.mockResolvedValue(mockGrant);

      const req: any = { user: { id: 'test_user_id' } };
      const res = await controller.getHighlightPlaybackGrant(req, 'hl_888');

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockGrant);
      expect(authService.getHighlightPlaybackGrant).toHaveBeenCalledWith(
        'hl_888',
        'test_user_id',
        undefined,
      );
    });
  });
});
