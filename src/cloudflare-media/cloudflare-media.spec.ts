import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { CloudflareMediaService } from './cloudflare-media.service';
import { CloudflareMediaController } from './cloudflare-media.controller';

import { CloudflareR2StorageAdapter } from '../media-provider/adapters/cloudflare-r2-storage.adapter';
import { CloudflareStreamVodAdapter } from '../media-provider/adapters/cloudflare-stream-vod.adapter';
import { CloudflareStreamLiveAdapter } from '../media-provider/adapters/cloudflare-stream-live.adapter';
import { CloudflarePlaybackTokenService } from '../media-provider/services/cloudflare-playback-token.service';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';

import { Recording } from '../recording/entities/recording.entity';
import { Camera } from '../camera/camera.entity';
import { RecordingHighlights } from '../recording/entities/recording-highlights.entity';
import { TournamentEntity } from '../tournament/entities/tournament.entity';

describe('CloudflareMediaService & Controller', () => {
  let service: CloudflareMediaService;
  let controller: CloudflareMediaController;

  const mockRecordingRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: jest.fn().mockImplementation(async (entity) => entity),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockCameraRepo = {
    findOne: jest.fn(),
  };

  const mockHighlightRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: jest.fn().mockImplementation(async (entity) => entity),
  };

  const mockTournamentRepo = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockDataSource = {
    query: jest.fn().mockResolvedValue([]),
  };

  const mockR2Adapter = {
    headObject: jest.fn().mockResolvedValue({
      key: 'recordings/test.mp4',
      bucket: 'fieldflicks-media',
      sizeBytes: 1024,
      contentType: 'video/mp4',
      etag: 'test-etag',
    }),
    generateUploadPresignedUrl: jest.fn().mockResolvedValue({
      provider: 'r2',
      uploadUrl:
        'https://r2.cloudflarestorage.com/fieldflicks-bucket/recordings/test.mp4?sig=xyz',
      key: 'recordings/test.mp4',
      bucket: 'fieldflicks-media',
      expiresInSeconds: 7200,
    }),
    generateDownloadPresignedUrl: jest.fn().mockResolvedValue({
      provider: 'r2',
      downloadUrl:
        'https://r2.cloudflarestorage.com/fieldflicks-bucket/recordings/test.mp4?downloadSig=abc',
      expiresInSeconds: 21600,
    }),
  };

  const mockVodAdapter = {
    createAssetFromUrl: jest.fn().mockResolvedValue({
      provider: 'cloudflare',
      assetId: 'cf-uid-1234567890abcdef1234567890abcdef',
      playbackId: 'cf-uid-1234567890abcdef1234567890abcdef',
      playbackUrl:
        'https://videodelivery.net/cf-uid-1234567890abcdef1234567890abcdef/manifest/video.m3u8',
      status: 'preparing',
    }),
    getAsset: jest.fn().mockResolvedValue({
      provider: 'cloudflare',
      assetId: 'cf-uid-1234567890abcdef1234567890abcdef',
      playbackId: 'cf-uid-1234567890abcdef1234567890abcdef',
      playbackUrl:
        'https://videodelivery.net/cf-uid-1234567890abcdef1234567890abcdef/manifest/video.m3u8',
      status: 'ready',
    }),
    createClip: jest.fn().mockResolvedValue({
      provider: 'cloudflare',
      clipAssetId: 'clip-uid-9999',
      playbackId: 'clip-uid-9999',
      playbackUrl:
        'https://videodelivery.net/clip-uid-9999/manifest/video.m3u8',
      status: 'ready',
    }),
  };

  const mockLiveAdapter = {
    createLiveStream: jest.fn().mockResolvedValue({
      provider: 'cloudflare',
      providerLiveStreamId: 'live-uid-court-1',
      rtmpUrl: 'rtmps://live.cloudflare.com:443/live/secret-stream-key',
      playbackUrl:
        'https://videodelivery.net/live-uid-court-1/manifest/video.m3u8',
      streamKey: 'secret-stream-key',
      status: 'ready',
    }),
    stopLiveStream: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockTokenService = {
    generateSignedToken: jest.fn().mockResolvedValue({
      token: 'jwt.token.signed',
      expiresAt: new Date(),
    }),
  };

  const mockPiApiService = {
    extractSession: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    startLiveStream: jest
      .fn()
      .mockResolvedValue({ status: 'LIVE_STREAM_STARTED' }),
    stopLiveStream: jest.fn().mockResolvedValue({ status: 'ALREADY_STOPPED' }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'CLOUDFLARE_R2_BUCKET_NAME')
        return 'fieldflicks-production-media';
      if (key === 'APP_BASE_URL') return 'https://api.fieldflicks.com';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudflareMediaController],
      providers: [
        CloudflareMediaService,
        { provide: getRepositoryToken(Recording), useValue: mockRecordingRepo },
        { provide: getRepositoryToken(Camera), useValue: mockCameraRepo },
        {
          provide: getRepositoryToken(RecordingHighlights),
          useValue: mockHighlightRepo,
        },
        {
          provide: getRepositoryToken(TournamentEntity),
          useValue: mockTournamentRepo,
        },
        { provide: DataSource, useValue: mockDataSource },
        { provide: CloudflareR2StorageAdapter, useValue: mockR2Adapter },
        { provide: CloudflareStreamVodAdapter, useValue: mockVodAdapter },
        { provide: CloudflareStreamLiveAdapter, useValue: mockLiveAdapter },
        { provide: CloudflarePlaybackTokenService, useValue: mockTokenService },
        { provide: RaspberryPiApiService, useValue: mockPiApiService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CloudflareMediaService>(CloudflareMediaService);
    controller = module.get<CloudflareMediaController>(
      CloudflareMediaController,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
  });

  describe('1. On-Demand Extraction to R2', () => {
    it('should generate R2 upload URL and dispatch extraction to Raspberry Pi', async () => {
      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-uuid-1',
        name: 'Court 3 Camera',
        court_number: 3,
        turfId: 'turf-uuid-1',
        raspberryPiBaseUrl: 'https://cpu.taild82368.ts.net',
        raspberryPiApiKey: 'test-api-key',
      });

      const res = await service.extractSessionToR2({
        cameraId: 'cam-uuid-1',
        startTime: '2026-09-24T10:00:00.000Z',
        endTime: '2026-09-24T11:00:00.000Z',
      });

      expect(res.status).toBe('extracting');
      expect(res.r2Key).toContain('recordings/');
      expect(res.uploadUrl).toContain('r2.cloudflarestorage.com');
      expect(mockR2Adapter.generateUploadPresignedUrl).toHaveBeenCalled();
      expect(mockRecordingRepo.save).toHaveBeenCalled();
    });
  });

  describe('2. Pi Callback & Parallel Cloudflare Stream Ingestion', () => {
    it('should mark video ready in R2 immediately and start Cloudflare Stream copy', async () => {
      mockRecordingRepo.findOne.mockResolvedValue({
        id: 'rec-uuid-1',
        status: 'extracting',
        metadata: {
          r2Key: 'recordings/rec-uuid-1.mp4',
          r2Bucket: 'fieldflicks-production-media',
        },
      });

      const res = await service.handleR2Callback({
        status: 'SUCCESS',
        recordingId: 'rec-uuid-1',
        r2Key: 'recordings/rec-uuid-1.mp4',
        durationSeconds: 3600,
      });

      expect(res.success).toBe(true);
      expect(mockRecordingRepo.update).toHaveBeenCalledWith(
        'rec-uuid-1',
        expect.objectContaining({
          status: 'ready',
          isVideoCreated: true,
        }),
      );
      expect(mockVodAdapter.createAssetFromUrl).toHaveBeenCalled();
    });
  });

  describe('3. Dynamic Dual Playback Architecture', () => {
    it('SCENARIO A: while Cloudflare Stream is still processing, delivers direct R2 progressive MP4', async () => {
      mockRecordingRepo.findOne.mockResolvedValue({
        id: 'rec-uuid-1',
        status: 'ready',
        duration: 3600,
        metadata: {
          r2Key: 'recordings/rec-uuid-1.mp4',
          r2Bucket: 'fieldflicks-production-media',
          r2Status: 'ready',
          cloudflareStreamUid: 'cf-uid-1234567890abcdef1234567890abcdef',
          cloudflareStreamStatus: 'processing', // Still encoding!
        },
      });

      const playback = await controller.getPlayback('rec-uuid-1');

      expect(playback.activeProvider).toBe('CLOUDFLARE_R2');
      expect(playback.status).toBe('STREAM_PROCESSING');
      expect(playback.activeUrl).toContain('downloadSig=abc'); // R2 direct URL
      expect(playback.r2.available).toBe(true);
      expect(playback.stream.available).toBe(false);
    });

    it('SCENARIO B: when Cloudflare Stream completes, automatically switches to adaptive bitrate HLS', async () => {
      mockRecordingRepo.findOne.mockResolvedValue({
        id: 'rec-uuid-1',
        status: 'ready',
        duration: 3600,
        metadata: {
          r2Key: 'recordings/rec-uuid-1.mp4',
          r2Bucket: 'fieldflicks-production-media',
          r2Status: 'ready',
          cloudflareStreamUid: 'cf-uid-1234567890abcdef1234567890abcdef',
          cloudflareStreamStatus: 'ready', // Transcoding finished!
        },
      });

      const playback = await controller.getPlayback('rec-uuid-1');

      expect(playback.activeProvider).toBe('CLOUDFLARE_STREAM');
      expect(playback.status).toBe('STREAM_READY');
      expect(playback.activeUrl).toContain('videodelivery.net'); // Cloudflare Stream manifest
      expect(playback.stream.available).toBe(true);
    });
  });

  describe('4. Active Stream Sync', () => {
    it('should poll Cloudflare Stream API and update status to ready when finished', async () => {
      mockRecordingRepo.findOne.mockResolvedValue({
        id: 'rec-uuid-1',
        status: 'ready',
        metadata: {
          r2Key: 'recordings/rec-uuid-1.mp4',
          cloudflareStreamUid: 'cf-uid-1234567890abcdef1234567890abcdef',
          cloudflareStreamStatus: 'processing',
        },
      });

      await service.syncStreamStatus('rec-uuid-1');

      expect(mockVodAdapter.getAsset).toHaveBeenCalledWith(
        'cf-uid-1234567890abcdef1234567890abcdef',
      );
      expect(mockRecordingRepo.update).toHaveBeenCalledWith(
        'rec-uuid-1',
        expect.objectContaining({
          status: 'ready',
        }),
      );
    });
  });

  describe('5. Cloudflare Live Streaming', () => {
    it('should create Cloudflare live input and command Pi relay', async () => {
      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-uuid-1',
        name: 'Court 3 Camera',
        court_number: 3,
        raspberryPiBaseUrl: 'https://cpu.taild82368.ts.net',
        raspberryPiApiKey: 'test-api-key',
      });

      const live = await controller.startLive({
        cameraId: 'cam-uuid-1',
        channel: 3,
      });

      expect(live.success).toBe(true);
      expect(live.liveStreamId).toBe('live-uid-court-1');
      expect(live.playbackUrl).toContain('videodelivery.net');
      expect(mockLiveAdapter.createLiveStream).toHaveBeenCalled();
      expect(mockPiApiService.startLiveStream).toHaveBeenCalledWith(
        'https://cpu.taild82368.ts.net',
        expect.objectContaining({
          channel: 3,
          rtmpUrl: expect.stringContaining('rtmps://live.cloudflare.com'),
        }),
        'test-api-key',
      );
    });

    it('should stop live stream on Pi and Cloudflare Live Input', async () => {
      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-uuid-1',
        raspberryPiBaseUrl: 'https://cpu.taild82368.ts.net',
        raspberryPiApiKey: 'test-api-key',
      });

      const res = await controller.stopLive({
        cameraId: 'cam-uuid-1',
        liveInputId: 'live-uid-court-1',
      });

      expect(res.success).toBe(true);
      expect(mockPiApiService.stopLiveStream).toHaveBeenCalled();
      expect(mockLiveAdapter.stopLiveStream).toHaveBeenCalledWith(
        'live-uid-court-1',
      );
    });
  });

  describe('6. Cloudflare Highlight Clipping', () => {
    it('should create trimmed clip directly using Cloudflare Stream', async () => {
      mockRecordingRepo.findOne.mockResolvedValue({
        id: 'rec-uuid-1',
        metadata: {
          cloudflareStreamUid: 'cf-parent-uid-123',
        },
      });

      const clip = await controller.createClip({
        recordingId: 'rec-uuid-1',
        startTimeSeconds: 30,
        endTimeSeconds: 60,
      });

      expect(clip.clipAssetId).toBe('clip-uid-9999');
      expect(clip.playbackUrl).toContain('videodelivery.net');
      expect(mockVodAdapter.createClip).toHaveBeenCalledWith(
        expect.objectContaining({
          parentAssetId: 'cf-parent-uid-123',
          startTimeSeconds: 30,
          endTimeSeconds: 60,
        }),
      );
      expect(mockHighlightRepo.save).toHaveBeenCalled();
    });
  });
});
