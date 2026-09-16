import { ConflictException, BadRequestException } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { Recording } from '../entities/recording.entity';
import { Camera } from '../../camera/camera.entity';

describe('RecordingService Stale Extraction and Prior Claim Recovery', () => {
  let service: RecordingService;
  let mockRecordingRepo: any;
  let mockCameraRepo: any;
  let mockFileService: any;
  let mockMuxService: any;
  let mockSharedRecordingRepo: any;
  let mockPricingConfigService: any;

  beforeEach(() => {
    mockRecordingRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: dto.id || 'new-rec-id' })),
      query: jest.fn().mockResolvedValue([]),
      manager: {
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getOne: jest.fn().mockResolvedValue(null),
        }),
      },
    };

    mockCameraRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    mockFileService = {
      findFirstObjectKeyWithPrefix: jest.fn().mockResolvedValue(null),
      getSignedUrlFromS3: jest
        .fn()
        .mockResolvedValue('https://s3.signed.url/video.mp4'),
    };

    mockMuxService = {
      getAssetDetails: jest.fn().mockResolvedValue(null),
      createDirectUpload: jest.fn().mockResolvedValue({
        uploadUrl: 'https://mux.upload.url',
        uploadId: 'mux-upload-123',
      }),
      uploadFromS3: jest.fn().mockResolvedValue({ assetId: 'new-mux-asset' }),
      signPlaybackToken: jest.fn().mockResolvedValue({ token: 'signed-token' }),
    };

    mockSharedRecordingRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
    };

    mockPricingConfigService = {
      getConfig: jest.fn().mockReturnValue({
        cricketHourlyRate: 200,
        pickleballHourlyRate: 150,
        padelHourlyRate: 250,
        serviceFeePercentage: 0,
      }),
    };

    service = new RecordingService(
      mockRecordingRepo, // 0: recordingRepository
      mockCameraRepo as any, // 1: cameraRepository
      {} as any, // 2: recordingHighlightsRepository
      {} as any, // 3: raspberryPiApiService
      mockFileService as any, // 4: fileServiceService
      mockRecordingRepo, // 5: recordingRepositoryForMedia
      mockSharedRecordingRepo as any, // 6: sharedRecordingRepository
      {} as any, // 7: userRepository
      mockMuxService as any, // 8: muxService
      {} as any, // 9: fireBaseNotificationService
      {} as any, // 10: dataSource
      {} as any, // 11: recordingHighlightEngagementService
      {
        attachHighlightsInTimeWindow: jest.fn().mockResolvedValue(undefined),
        ensureHighlightClipsForRecording: jest
          .fn()
          .mockResolvedValue(undefined),
      } as any, // 12: recordingHighlightsService
      {} as any, // 13: paymentRestrictionService
      {
        awardPoints: jest.fn().mockResolvedValue(false),
        updateStreak: jest.fn().mockResolvedValue(undefined),
      } as any, // 14: pointsService
      mockPricingConfigService as any, // 15: pricingConfigService
    );
  });

  describe('sweepStaleOnDemandExtractions', () => {
    it('should NOT fail extractions that are under 120 minutes old (e.g. 35m or 90m old)', async () => {
      const now = Date.now();
      const thirtyFiveMinutesAgo = new Date(now - 35 * 60 * 1000);
      const ninetyMinutesAgo = new Date(now - 90 * 60 * 1000);

      const rec1 = {
        id: 'rec-35m',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: thirtyFiveMinutesAgo,
        metadata: { extract_attempts: 1 },
      } as unknown as Recording;

      const rec2 = {
        id: 'rec-90m',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: ninetyMinutesAgo,
        metadata: { extract_attempts: 1 },
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([rec1, rec2]);

      await service.sweepStaleOnDemandExtractions();

      // Neither should be updated to failed because 120m cutoff has not passed
      expect(mockRecordingRepo.update).not.toHaveBeenCalled();
    });

    it('should fail extractions older than 120 minutes without video or S3 objects', async () => {
      const now = Date.now();
      const twoHoursTenMinAgo = new Date(now - 130 * 60 * 1000);
      const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

      const staleRec = {
        id: 'stale-rec-1',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: twoHoursTenMinAgo,
        metadata: { extract_attempts: 1 },
      } as unknown as Recording;

      const freshRec = {
        id: 'fresh-rec-2',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: tenMinutesAgo,
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([staleRec, freshRec]);
      mockFileService.findFirstObjectKeyWithPrefix.mockResolvedValue(null);

      await service.sweepStaleOnDemandExtractions();

      expect(mockRecordingRepo.update).toHaveBeenCalledTimes(1);
      expect(mockRecordingRepo.update).toHaveBeenCalledWith('stale-rec-1', {
        status: 'failed',
        metadata: expect.objectContaining({
          extract_failed_reason: expect.stringContaining('120 minutes'),
        }),
      });
    });

    it('should recover stale extraction if an S3 file exists rather than failing', async () => {
      const now = Date.now();
      const twoHoursTenMinAgo = new Date(now - 130 * 60 * 1000);

      const staleRecWithS3 = {
        id: 'stale-rec-s3',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: twoHoursTenMinAgo,
        metadata: { extract_attempts: 1 },
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([staleRecWithS3]);
      mockFileService.findFirstObjectKeyWithPrefix.mockResolvedValue(
        'recordings/stale-rec-s3_20260916.mp4',
      );
      mockRecordingRepo.findOne.mockResolvedValue(staleRecWithS3);

      await service.sweepStaleOnDemandExtractions();

      expect(mockRecordingRepo.update).toHaveBeenCalledWith(
        'stale-rec-s3',
        expect.objectContaining({
          status: 'uploaded',
          s3Path: expect.stringContaining(
            'recordings/stale-rec-s3_20260916.mp4',
          ),
        }),
      );
    });

    it('should heal stale extraction if Mux asset is ready rather than failing', async () => {
      const now = Date.now();
      const twoHoursTenMinAgo = new Date(now - 130 * 60 * 1000);

      const staleRecWithMux = {
        id: 'stale-rec-mux',
        status: 'extracting',
        mux_asset_id: 'mux-asset-123',
        mux_playback_id: null,
        updated_at: twoHoursTenMinAgo,
        metadata: { extract_attempts: 1 },
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([staleRecWithMux]);
      mockFileService.findFirstObjectKeyWithPrefix.mockResolvedValue(null);
      mockMuxService.getAssetDetails.mockResolvedValue({
        status: 'ready',
        playback_ids: [{ id: 'live-playback-999', policy: 'public' }],
      });

      await service.sweepStaleOnDemandExtractions();

      expect(mockRecordingRepo.update).toHaveBeenCalledWith(
        'stale-rec-mux',
        expect.objectContaining({
          status: 'ready',
          mux_playback_id: 'live-playback-999',
          isVideoCreated: true,
        }),
      );
    });
  });

  describe('getMyRecordings', () => {
    it('should return all user recordings including failed ones so app shows failed badge', async () => {
      const failedRec = {
        id: 'rec-failed',
        userId: 'user-1',
        status: 'failed',
        metadata: { extract_failed_reason: 'Extraction timed out' },
      } as unknown as Recording;

      const readyRec = {
        id: 'rec-ready',
        userId: 'user-1',
        status: 'ready',
        mux_playback_id: 'mux-play-1',
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([failedRec, readyRec]);

      const results = await service.getMyRecordings('user-1');

      expect(mockRecordingRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' }, // Ensures status: Not('failed') is NOT present
        }),
      );
      expect(results).toHaveLength(2);
      expect(results.some((r) => r.status === 'failed')).toBe(true);
      expect(results.some((r) => r.status === 'ready')).toBe(true);
    });

    it('should self-heal recording status to ready when mux_playback_id exists', async () => {
      const unhealedRec = {
        id: 'rec-needs-heal',
        userId: 'user-1',
        status: 'extracting',
        mux_playback_id: 'play-123',
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([unhealedRec]);

      const results = await service.getMyRecordings('user-1');

      expect(results[0].status).toBe('ready');
      expect(mockRecordingRepo.update).toHaveBeenCalledWith(
        'rec-needs-heal',
        expect.objectContaining({ status: 'ready', isVideoCreated: true }),
      );
    });
  });

  describe('requestOnDemandExtraction', () => {
    it('should auto-mark stalled prior claim as failed and allow re-claim instead of throwing 409', async () => {
      const now = Date.now();
      const twentyFiveMinutesAgo = new Date(now - 25 * 60 * 1000);

      const stalledPriorClaim = {
        id: 'prior-stalled-id',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: twentyFiveMinutesAgo,
        metadata: {},
      } as unknown as Recording;

      mockRecordingRepo.findOne.mockImplementation(async (query: any) => {
        if (query?.where?.userId === 'user-1') {
          return stalledPriorClaim;
        }
        return null;
      });

      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-1',
        name: 'Court 1',
        court_number: 1,
        raspberryPiBaseUrl: 'http://pi.local:8000',
        turf: { name: 'Turf A' },
      } as unknown as Camera);

      const startDate = new Date(now - 60 * 60 * 1000);
      const endDate = new Date(now - 30 * 60 * 1000);

      try {
        await service.requestOnDemandExtraction(
          {
            cameraId: 'cam-1',
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
          },
          'user-1',
        );
      } catch {
        // May catch subsequent steps after priorClaim check
      }

      expect(mockRecordingRepo.update).toHaveBeenCalledWith(
        'prior-stalled-id',
        expect.objectContaining({
          status: 'failed',
          metadata: expect.objectContaining({
            extract_failed_reason: expect.stringContaining('>20m'),
          }),
        }),
      );
    });

    it('should throw ConflictException if prior claim is active and recent (<20m)', async () => {
      const now = Date.now();
      const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);

      const activePriorClaim = {
        id: 'prior-active-id',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: fiveMinutesAgo,
      } as unknown as Recording;

      mockRecordingRepo.findOne.mockResolvedValue(activePriorClaim);

      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-1',
        name: 'Court 1',
      } as unknown as Camera);

      const startDate = new Date(now - 60 * 60 * 1000);
      const endDate = new Date(now - 30 * 60 * 1000);

      await expect(
        service.requestOnDemandExtraction(
          {
            cameraId: 'cam-1',
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if user ID is missing', async () => {
      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-1',
        name: 'Court 1',
      } as unknown as Camera);

      await expect(
        service.requestOnDemandExtraction({
          cameraId: 'cam-1',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create extraction record even when camera has no raspberryPiBaseUrl', async () => {
      const now = Date.now();
      const startDate = new Date(now - 60 * 60 * 1000);
      const endDate = new Date(now - 30 * 60 * 1000);

      mockRecordingRepo.findOne.mockResolvedValue(null);
      mockRecordingRepo.find.mockResolvedValue([]);

      mockCameraRepo.findOne.mockResolvedValue({
        id: 'cam-cloud-only',
        name: 'Court 2 (No Pi)',
        court_number: 2,
        raspberryPiBaseUrl: null, // No Raspberry Pi!
        turf: { name: 'Turf B' },
      } as unknown as Camera);

      const result = await service.requestOnDemandExtraction(
        {
          cameraId: 'cam-cloud-only',
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
        },
        'user-123',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('PROCESSING');
      expect(mockRecordingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cameraId: 'cam-cloud-only',
          userId: 'user-123',
          status: 'extracting',
        }),
      );
    });
  });
});
