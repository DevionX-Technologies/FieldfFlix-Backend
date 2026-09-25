import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { GameEntity } from './entities/game.entity';
import { RecordingService } from '../recording/service/recording.service';
import { MediaProviderFactory } from '../media-provider/services/media-provider-factory.service';
import { CloudflarePlaybackTokenService } from '../media-provider/services/cloudflare-playback-token.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Games Module', () => {
  let service: GamesService;
  let controller: GamesController;

  const mockGame: Partial<GameEntity> = {
    id: '11111111-1111-1111-1111-111111111111',
    tournamentId: '22222222-2222-2222-2222-222222222222',
    courtNumber: 1,
    round: 'Finals',
    teamA: 'Team Alpha',
    teamB: 'Team Beta',
    status: 'scheduled',
    recordingId: null,
    scheduledAt: new Date('2026-09-24T10:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGameRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...mockGame, ...dto })),
    save: jest
      .fn()
      .mockImplementation((game) => Promise.resolve({ ...mockGame, ...game })),
    find: jest.fn().mockResolvedValue([mockGame]),
    findOne: jest.fn().mockImplementation(({ where: { id } }) => {
      if (id === mockGame.id) return Promise.resolve({ ...mockGame });
      return Promise.resolve(null);
    }),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  const mockRecordingService = {
    getRecordingById: jest.fn(),
    extractMatchVideo: jest.fn(),
  };

  const mockStorageProvider = {
    providerName: 'r2',
    generateDownloadPresignedUrl: jest.fn().mockResolvedValue({
      downloadUrl:
        'https://test-account.r2.cloudflarestorage.com/recordings/test.mp4?signed=true',
      expiresInSeconds: 21600,
    }),
    generateUploadPresignedUrl: jest.fn(),
  };

  const mockMediaProviderFactory = {
    getStorageProvider: jest.fn().mockReturnValue(mockStorageProvider),
  };

  const mockCfPlaybackTokenService = {
    generateSignedToken: jest.fn().mockResolvedValue({
      token: 'mock-cf-token',
      expiresAt: Math.floor(Date.now() / 1000) + 21600,
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GamesController],
      providers: [
        GamesService,
        {
          provide: getRepositoryToken(GameEntity),
          useValue: mockGameRepo,
        },
        {
          provide: RecordingService,
          useValue: mockRecordingService,
        },
        {
          provide: MediaProviderFactory,
          useValue: mockMediaProviderFactory,
        },
        {
          provide: CloudflarePlaybackTokenService,
          useValue: mockCfPlaybackTokenService,
        },
      ],
    }).compile();

    service = module.get<GamesService>(GamesService);
    controller = module.get<GamesController>(GamesController);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
  });

  describe('GamesService CRUD', () => {
    it('should create a game', async () => {
      const dto = {
        tournamentId: '22222222-2222-2222-2222-222222222222',
        courtNumber: 2,
        teamA: 'A',
        teamB: 'B',
      };
      const result = await service.create(dto, 'user-123');
      expect(result.tournamentId).toBe(dto.tournamentId);
      expect(mockGameRepo.create).toHaveBeenCalled();
      expect(mockGameRepo.save).toHaveBeenCalled();
    });

    it('should find games by tournament', async () => {
      const results = await service.findByTournament(
        '22222222-2222-2222-2222-222222222222',
      );
      expect(results).toHaveLength(1);
      expect(mockGameRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tournamentId: '22222222-2222-2222-2222-222222222222' },
        }),
      );
    });

    it('should throw NotFoundException when game not found', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should transition game status correctly', async () => {
      const live = await service.markLive(mockGame.id!);
      expect(live.status).toBe('live');
    });

    it('should reject invalid status transition', async () => {
      mockGameRepo.findOne.mockResolvedValueOnce({
        ...mockGame,
        status: 'completed',
      });
      await expect(service.markLive(mockGame.id!)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should link recording to a game', async () => {
      const recordingId = 'rec-999';
      const updated = await service.linkRecording(mockGame.id!, recordingId);
      expect(updated.recordingId).toBe(recordingId);
    });
  });

  describe('Dual-Path Playback & Download', () => {
    it('should return unplayable response when no recording is linked', async () => {
      const playback = await service.getPlayback(mockGame.id!);
      expect(playback.playable).toBe(false);
      expect(playback.direct_playback_url).toBeNull();
      expect(playback.stream_playback_url).toBeNull();
    });

    it('should return dual URLs when recording has R2 storage and Cloudflare Stream UID', async () => {
      mockGameRepo.findOne.mockResolvedValueOnce({
        ...mockGame,
        recordingId: 'rec-123',
      });

      mockRecordingService.getRecordingById.mockResolvedValueOnce({
        id: 'rec-123',
        status: 'ready',
        s3Path:
          's3://fieldflicks-media-production/tournaments/t1/matches/m1/recordings/test.mp4',
        metadata: {
          provider: 'cloudflare',
          cloudflareStreamUid: 'cf-uid-12345',
          cloudflareStreamStatus: 'ready',
          r2Key: 'tournaments/t1/matches/m1/recordings/test.mp4',
        },
      });

      const playback = await service.getPlayback(mockGame.id!);
      expect(playback.playable).toBe(true);
      expect(playback.is_direct_ready).toBe(true);
      expect(playback.is_stream_ready).toBe(true);
      expect(playback.direct_playback_url).toContain(
        'r2.cloudflarestorage.com',
      );
      expect(playback.stream_playback_url).toContain('videodelivery.net');
      expect(playback.download_url).toBe(playback.direct_playback_url);
    });

    it('should allow immediate direct playback from R2 even if Stream is still processing', async () => {
      mockGameRepo.findOne.mockResolvedValueOnce({
        ...mockGame,
        recordingId: 'rec-456',
      });

      mockRecordingService.getRecordingById.mockResolvedValueOnce({
        id: 'rec-456',
        status: 'ready',
        s3Path:
          's3://fieldflicks-media-production/tournaments/t1/recordings/direct.mp4',
        metadata: {
          provider: 'cloudflare',
          cloudflareStreamUid: 'cf-uid-queued',
          cloudflareStreamStatus: 'queued', // Stream is still processing!
        },
      });

      const playback = await service.getPlayback(mockGame.id!);
      // Mobile app can play immediately via direct R2 without waiting for stream transcoding!
      expect(playback.playable).toBe(true);
      expect(playback.is_direct_ready).toBe(true);
      expect(playback.is_stream_ready).toBe(false);
      expect(playback.direct_playback_url).toBeTruthy();
      expect(playback.signed_url).toBe(playback.direct_playback_url);
    });

    it('should provide direct download URL', async () => {
      mockGameRepo.findOne.mockResolvedValueOnce({
        ...mockGame,
        recordingId: 'rec-789',
      });

      mockRecordingService.getRecordingById.mockResolvedValueOnce({
        id: 'rec-789',
        status: 'ready',
        s3Path: 's3://fieldflicks-media-production/rec.mp4',
        metadata: {},
      });

      const download = await service.getDownloadUrl(mockGame.id!);
      expect(download.downloadUrl).toContain('r2.cloudflarestorage.com');
      expect(download.expiresInSeconds).toBe(21600);
    });
  });

  describe('Match Extraction', () => {
    it('should dispatch match extraction and link recording to game', async () => {
      mockRecordingService.extractMatchVideo.mockResolvedValueOnce({
        recordingId: 'new-rec-id',
        status: 'extracting',
        message: 'Dispatched',
      });

      const result = await service.extractMatch(
        mockGame.id!,
        {
          startTime: '2026-09-24T10:00:00Z',
          endTime: '2026-09-24T11:00:00Z',
        },
        'user-123',
      );

      expect(result.gameId).toBe(mockGame.id);
      expect(result.recordingId).toBe('new-rec-id');
      expect(mockRecordingService.extractMatchVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: mockGame.id,
          startTime: '2026-09-24T10:00:00Z',
          endTime: '2026-09-24T11:00:00Z',
        }),
      );
    });
  });
});
