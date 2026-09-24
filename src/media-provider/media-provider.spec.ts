import { MediaFeatureFlagsService } from './services/media-feature-flags.service';
import { MediaProviderFactory } from './services/media-provider-factory.service';
import { MuxLiveAdapter } from './adapters/mux-live.adapter';
import { MuxVodAdapter } from './adapters/mux-vod.adapter';
import { AwsS3StorageAdapter } from './adapters/aws-s3-storage.adapter';
import { CloudflareR2StorageAdapter } from './adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamLiveAdapter } from './adapters/cloudflare-stream-live.adapter';
import { CloudflareStreamVodAdapter } from './adapters/cloudflare-stream-vod.adapter';
import { R2ObjectKeyBuilder } from './utils/r2-object-key.builder';
import {
  MediaProviderAuthError,
  MediaProviderError,
  MediaProviderRateLimitError,
  MediaProviderTimeoutError,
  isRetryableMediaError,
} from './errors/media-provider.error';
import { ILiveStreamProvider } from './interfaces/live-stream-provider.interface';

describe('MediaProvider Subsystem', () => {
  describe('MediaFeatureFlagsService', () => {
    let service: MediaFeatureFlagsService;
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.MEDIA_STORAGE_PROVIDER;
      delete process.env.MEDIA_LIVE_PROVIDER;
      delete process.env.MEDIA_VOD_PROVIDER;
      delete process.env.CLOUDFLARE_FEATURE_FLAG_TOURNAMENT_IDS;
      delete process.env.CLOUDFLARE_FEATURE_FLAG_TURF_IDS;
      service = new MediaFeatureFlagsService();
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should default to legacy providers (s3 and mux) when no env flags set', () => {
      expect(service.getStorageProvider()).toBe('s3');
      expect(service.getLiveProvider()).toBe('mux');
      expect(service.getVodProvider()).toBe('mux');
      expect(service.isCloudflareStorageEnabled()).toBe(false);
      expect(service.isCloudflareLiveEnabled()).toBe(false);
      expect(service.isCloudflareVodEnabled()).toBe(false);
    });

    it('should respect global environment variables', () => {
      process.env.MEDIA_STORAGE_PROVIDER = 'r2';
      process.env.MEDIA_LIVE_PROVIDER = 'cloudflare';
      process.env.MEDIA_VOD_PROVIDER = 'cloudflare';

      expect(service.getStorageProvider()).toBe('r2');
      expect(service.getLiveProvider()).toBe('cloudflare');
      expect(service.getVodProvider()).toBe('cloudflare');
      expect(service.isCloudflareStorageEnabled()).toBe(true);
      expect(service.isCloudflareLiveEnabled()).toBe(true);
      expect(service.isCloudflareVodEnabled()).toBe(true);
    });

    it('should activate Cloudflare for scoped tournament context', () => {
      process.env.CLOUDFLARE_FEATURE_FLAG_TOURNAMENT_IDS =
        'tournament-alpha, tournament-beta';

      // Non-matching tournament remains on default
      expect(
        service.getLiveProvider({ tournamentId: 'tournament-gamma' }),
      ).toBe('mux');

      // Matching tournament activates Cloudflare
      expect(
        service.getLiveProvider({ tournamentId: 'tournament-alpha' }),
      ).toBe('cloudflare');
      expect(
        service.getStorageProvider({ tournamentId: 'tournament-beta' }),
      ).toBe('r2');
      expect(service.getVodProvider({ tournamentId: 'tournament-alpha' })).toBe(
        'cloudflare',
      );
    });

    it('should activate Cloudflare for scoped turf context', () => {
      process.env.CLOUDFLARE_FEATURE_FLAG_TURF_IDS = 'turf-mumbai-1';

      expect(service.getLiveProvider({ turfId: 'turf-delhi-1' })).toBe('mux');
      expect(service.getLiveProvider({ turfId: 'turf-mumbai-1' })).toBe(
        'cloudflare',
      );
    });

    it('should allow runtime overrides to supersede env flags', () => {
      service.setLiveProviderOverride('cloudflare');
      expect(service.getLiveProvider()).toBe('cloudflare');

      service.setLiveProviderOverride(null);
      expect(service.getLiveProvider()).toBe('mux');
    });
  });

  describe('MediaProviderFactory', () => {
    let factory: MediaProviderFactory;
    let featureFlags: MediaFeatureFlagsService;
    let mockMuxLive: jest.Mocked<Partial<MuxLiveAdapter>>;
    let mockMuxVod: jest.Mocked<Partial<MuxVodAdapter>>;
    let mockS3Storage: jest.Mocked<Partial<AwsS3StorageAdapter>>;

    beforeEach(() => {
      featureFlags = new MediaFeatureFlagsService();
      mockMuxLive = {
        providerName: 'mux',
        createLiveStream: jest.fn(),
      };
      mockMuxVod = {
        providerName: 'mux',
        createDirectUpload: jest.fn(),
      };
      mockS3Storage = {
        providerName: 's3',
        generateUploadPresignedUrl: jest.fn(),
      };

      factory = new MediaProviderFactory(
        featureFlags,
        mockMuxLive as unknown as MuxLiveAdapter,
        mockMuxVod as unknown as MuxVodAdapter,
        mockS3Storage as unknown as AwsS3StorageAdapter,
      );
    });

    it('should return default legacy providers when flags are inactive', () => {
      const live = factory.getLiveStreamProvider();
      const storage = factory.getStorageProvider();
      const vod = factory.getVodProvider();

      expect(live.providerName).toBe('mux');
      expect(storage.providerName).toBe('s3');
      expect(vod.providerName).toBe('mux');
    });

    it('should fallback gracefully to legacy provider if target provider is not registered', () => {
      featureFlags.setLiveProviderOverride('cloudflare');
      featureFlags.setStorageProviderOverride('r2');

      // Cloudflare live is not registered yet, should safely fall back to Mux
      const live = factory.getLiveStreamProvider();
      expect(live.providerName).toBe('mux');

      // R2 is not registered yet, should safely fall back to S3
      const storage = factory.getStorageProvider();
      expect(storage.providerName).toBe('s3');
    });

    it('should resolve registered Cloudflare providers when flag is active', () => {
      const mockCloudflareLive: ILiveStreamProvider = {
        providerName: 'cloudflare',
        createLiveStream: jest.fn(),
        getLiveStream: jest.fn(),
        stopLiveStream: jest.fn(),
      };

      factory.registerLiveProvider(mockCloudflareLive);
      featureFlags.setLiveProviderOverride('cloudflare');

      const live = factory.getLiveStreamProvider();
      expect(live.providerName).toBe('cloudflare');
      expect(live).toBe(mockCloudflareLive);
    });
  });

  describe('Error Classification & Retries', () => {
    it('should classify rate limit and timeout errors as retryable', () => {
      const timeoutErr = new MediaProviderTimeoutError('cloudflare', 'fetch');
      const rateLimitErr = new MediaProviderRateLimitError('mux', 'clip', 30);
      const authErr = new MediaProviderAuthError('cloudflare', 'auth');

      expect(isRetryableMediaError(timeoutErr)).toBe(true);
      expect(isRetryableMediaError(rateLimitErr)).toBe(true);
      expect(isRetryableMediaError(authErr)).toBe(false);
    });

    it('should classify HTTP status codes 429 and 5xx as retryable', () => {
      expect(isRetryableMediaError({ response: { status: 429 } })).toBe(true);
      expect(isRetryableMediaError({ response: { status: 502 } })).toBe(true);
      expect(isRetryableMediaError({ response: { status: 503 } })).toBe(true);
      expect(isRetryableMediaError({ response: { status: 400 } })).toBe(false);
      expect(isRetryableMediaError({ response: { status: 404 } })).toBe(false);
    });
  });

  describe('MuxLiveAdapter', () => {
    it('should map createLiveStream response to standardized contract', async () => {
      const mockMuxService: any = {
        createLiveStream: jest.fn().mockResolvedValue({
          liveStreamId: 'mux-live-123',
          streamKey: 'key-abc',
          playbackId: 'play-xyz',
          rtmpUrl: 'rtmp://global-live.mux.com:5222/app/key-abc',
          playbackUrl: 'https://stream.mux.com/play-xyz.m3u8',
        }),
      };

      const adapter = new MuxLiveAdapter(mockMuxService);
      const result = await adapter.createLiveStream({ courtNumber: 1 });

      expect(result.provider).toBe('mux');
      expect(result.providerLiveStreamId).toBe('mux-live-123');
      expect(result.streamKey).toBe('key-abc');
      expect(result.playbackUrl).toBe('https://stream.mux.com/play-xyz.m3u8');
      expect(result.status).toBe('ready');
    });

    it('should wrap Mux failures in MediaProviderError', async () => {
      const mockMuxService: any = {
        createLiveStream: jest
          .fn()
          .mockRejectedValue(new Error('Mux API network down')),
      };

      const adapter = new MuxLiveAdapter(mockMuxService);
      await expect(adapter.createLiveStream({})).rejects.toThrow(
        MediaProviderError,
      );
    });
  });

  describe('R2ObjectKeyBuilder', () => {
    it('should build legacy recording keys', () => {
      const key = R2ObjectKeyBuilder.buildRecordingKey({
        recordingId: 'rec-123',
        timestamp: '1720000000',
        format: 'legacy',
      });
      expect(key).toBe('recordings/rec-123_1720000000.mp4');
    });

    it('should build structured recording keys', () => {
      const key = R2ObjectKeyBuilder.buildRecordingKey({
        recordingId: 'rec-123',
        timestamp: '1720000000',
        environment: 'staging',
      });
      expect(key).toBe('staging/recordings/rec-123/1720000000_original.mp4');
    });

    it('should build tournament recording keys', () => {
      const key = R2ObjectKeyBuilder.buildTournamentRecordingKey({
        tournamentId: 'tourn-456',
        courtId: 'court-2',
        recordingId: 'rec-123',
        environment: 'production',
      });
      expect(key).toBe(
        'production/tournaments/tourn-456/courts/court-2/recordings/rec-123/original.mp4',
      );
    });

    it('should build highlight and manifest keys', () => {
      const hlKey = R2ObjectKeyBuilder.buildHighlightKey({
        highlightId: 'hl-789',
        environment: 'production',
      });
      expect(hlKey).toBe('production/highlights/hl-789/clip.mp4');

      const manifestKey = R2ObjectKeyBuilder.buildHlsMasterManifestKey({
        recordingId: 'rec-123',
        environment: 'production',
      });
      expect(manifestKey).toBe('production/recordings/rec-123/hls/master.m3u8');
    });

    it('should parse legacy and structured keys correctly', () => {
      const legacyParsed = R2ObjectKeyBuilder.parseRecordingKey(
        'recordings/123e4567-e89b-12d3-a456-426614174000_1720000000.mp4',
      );
      expect(legacyParsed).toEqual({
        recordingId: '123e4567-e89b-12d3-a456-426614174000',
        isLegacy: true,
      });

      const structuredParsed = R2ObjectKeyBuilder.parseRecordingKey(
        'production/recordings/123e4567-e89b-12d3-a456-426614174000/1720000000_original.mp4',
      );
      expect(structuredParsed).toEqual({
        recordingId: '123e4567-e89b-12d3-a456-426614174000',
        isLegacy: false,
      });

      expect(R2ObjectKeyBuilder.parseRecordingKey('invalid-key')).toBeNull();
    });
  });

  describe('CloudflareR2StorageAdapter', () => {
    let adapter: CloudflareR2StorageAdapter;
    let mockS3Client: any;

    beforeEach(() => {
      mockS3Client = {
        send: jest.fn(),
      };
      adapter = new CloudflareR2StorageAdapter(undefined, mockS3Client);
    });

    it('should have providerName "r2"', () => {
      expect(adapter.providerName).toBe('r2');
    });

    it('should return null when headObject receives a 404/NotFound error', async () => {
      mockS3Client.send.mockRejectedValue({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });

      const meta = await adapter.headObject('missing-file.mp4');
      expect(meta).toBeNull();
    });

    it('should return metadata when headObject succeeds', async () => {
      mockS3Client.send.mockResolvedValue({
        ContentLength: 1048576,
        ContentType: 'video/mp4',
        LastModified: new Date('2026-09-24T00:00:00Z'),
        ETag: '"etag-123"',
      });

      const meta = await adapter.headObject('existing-file.mp4', 'my-bucket');
      expect(meta).toEqual({
        key: 'existing-file.mp4',
        bucket: 'my-bucket',
        sizeBytes: 1048576,
        contentType: 'video/mp4',
        lastModified: new Date('2026-09-24T00:00:00Z'),
        etag: '"etag-123"',
      });
    });

    it('should delete object successfully', async () => {
      mockS3Client.send.mockResolvedValue({});
      const res = await adapter.deleteObject('file-to-delete.mp4');
      expect(res).toEqual({ success: true });
      expect(mockS3Client.send).toHaveBeenCalled();
    });
  });

  describe('CloudflareStreamLiveAdapter', () => {
    let adapter: CloudflareStreamLiveAdapter;
    let mockHttpClient: any;

    beforeEach(() => {
      mockHttpClient = {
        post: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
      };
      adapter = new CloudflareStreamLiveAdapter(undefined, mockHttpClient);
    });

    it('should have providerName "cloudflare"', () => {
      expect(adapter.providerName).toBe('cloudflare');
    });

    it('should create live input and construct valid RTMPS ingest and playback URLs', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          result: {
            uid: 'cf-live-input-999',
            rtmps: {
              url: 'rtmps://live.cloudflare.com:443/live/',
              streamKey: 'secret-key-123',
            },
            status: 'disconnected',
          },
          success: true,
        },
      });

      const output = await adapter.createLiveStream({
        courtNumber: 3,
        tournamentId: 'tournament-xyz',
      });

      expect(output.provider).toBe('cloudflare');
      expect(output.providerLiveStreamId).toBe('cf-live-input-999');
      expect(output.streamKey).toBe('secret-key-123');
      expect(output.rtmpUrl).toBe(
        'rtmps://live.cloudflare.com:443/live/secret-key-123',
      );
      expect(output.playbackUrl).toBe(
        'https://videodelivery.net/cf-live-input-999/manifest/video.m3u8',
      );
      expect(output.status).toBe('ready');
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/live_inputs',
        expect.objectContaining({
          meta: expect.objectContaining({
            courtNumber: 3,
            tournamentId: 'tournament-xyz',
          }),
        }),
      );
    });

    it('should get live input details and map connected status to "live"', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          result: {
            uid: 'cf-live-input-999',
            rtmps: {
              url: 'rtmps://live.cloudflare.com:443/live/',
              streamKey: 'secret-key-123',
            },
            status: 'connected',
          },
          success: true,
        },
      });

      const output = await adapter.getLiveStream('cf-live-input-999');
      expect(output.providerLiveStreamId).toBe('cf-live-input-999');
      expect(output.status).toBe('live');
    });

    it('should stop live input successfully', async () => {
      mockHttpClient.delete.mockResolvedValue({ data: { success: true } });
      const res = await adapter.stopLiveStream('cf-live-input-999');
      expect(res).toEqual({ success: true });
      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        '/live_inputs/cf-live-input-999',
      );
    });

    it('should wrap Cloudflare Stream failures in MediaProviderError', async () => {
      mockHttpClient.post.mockRejectedValue({
        response: { status: 429, data: { errors: ['Rate limited'] } },
        message: 'Rate limit',
      });

      await expect(adapter.createLiveStream({})).rejects.toThrow(
        MediaProviderError,
      );
    });
  });

  describe('CloudflareStreamVodAdapter', () => {
    let adapter: CloudflareStreamVodAdapter;
    let mockHttpClient: any;

    beforeEach(() => {
      mockHttpClient = {
        post: jest.fn(),
        get: jest.fn(),
      };
      adapter = new CloudflareStreamVodAdapter(undefined, mockHttpClient);
    });

    it('should have providerName "cloudflare"', () => {
      expect(adapter.providerName).toBe('cloudflare');
    });

    it('should create direct upload URL successfully', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          result: {
            uploadURL: 'https://upload.videodelivery.net/direct-url-123',
            uid: 'cf-video-uid-123',
          },
          success: true,
        },
      });

      const res = await adapter.createDirectUpload({ passthrough: 'rec-123' });
      expect(res.provider).toBe('cloudflare');
      expect(res.uploadUrl).toBe(
        'https://upload.videodelivery.net/direct-url-123',
      );
      expect(res.uploadId).toBe('cf-video-uid-123');
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/direct_upload',
        expect.objectContaining({
          meta: { passthrough: 'rec-123' },
        }),
      );
    });

    it('should ingest video from URL and return playback URL', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          result: {
            uid: 'cf-video-uid-456',
            status: { state: 'inprogress' },
            duration: 1800,
          },
          success: true,
        },
      });

      const res = await adapter.createAssetFromUrl({
        sourceUrl: 'https://r2.example.com/recordings/test.mp4',
        passthrough: 'rec-456',
      });

      expect(res.provider).toBe('cloudflare');
      expect(res.assetId).toBe('cf-video-uid-456');
      expect(res.playbackUrl).toBe(
        'https://videodelivery.net/cf-video-uid-456/manifest/video.m3u8',
      );
      expect(res.status).toBe('preparing');
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/copy',
        expect.objectContaining({
          url: 'https://r2.example.com/recordings/test.mp4',
        }),
      );
    });

    it('should create highlight clip from parent asset UID', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: {
          result: {
            uid: 'cf-clip-uid-789',
            status: { state: 'ready' },
          },
          success: true,
        },
      });

      const res = await adapter.createClip({
        parentAssetId: 'cf-parent-uid-123',
        startTimeSeconds: 15.5,
        endTimeSeconds: 30.5,
        passthrough: 'highlight-789',
      });

      expect(res.provider).toBe('cloudflare');
      expect(res.clipAssetId).toBe('cf-clip-uid-789');
      expect(res.playbackUrl).toBe(
        'https://videodelivery.net/cf-clip-uid-789/manifest/video.m3u8',
      );
      expect(res.status).toBe('ready');
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/clip',
        expect.objectContaining({
          clippedFromVideoUID: 'cf-parent-uid-123',
          startTimeSeconds: 15.5,
          endTimeSeconds: 30.5,
        }),
      );
    });

    it('should get asset details including duration and dimensions', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          result: {
            uid: 'cf-video-uid-456',
            status: { state: 'ready' },
            duration: 120.5,
            input: { width: 1920, height: 1080 },
          },
          success: true,
        },
      });

      const res = await adapter.getAsset('cf-video-uid-456');
      expect(res.assetId).toBe('cf-video-uid-456');
      expect(res.status).toBe('ready');
      expect(res.durationSeconds).toBe(120.5);
      expect(res.width).toBe(1920);
      expect(res.height).toBe(1080);
    });

    it('should wrap errors into MediaProviderError', async () => {
      mockHttpClient.post.mockRejectedValue({
        response: { status: 500 },
        message: 'Internal Error',
      });

      await expect(
        adapter.createAssetFromUrl({ sourceUrl: 'http://test' }),
      ).rejects.toThrow(MediaProviderError);
    });
  });
});
