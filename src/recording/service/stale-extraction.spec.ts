import { ConflictException } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { Recording } from '../entities/recording.entity';
import { Camera } from '../../camera/camera.entity';

describe('RecordingService Stale Extraction and Prior Claim Recovery', () => {
  let service: RecordingService;
  let mockRecordingRepo: any;
  let mockCameraRepo: any;

  beforeEach(() => {
    mockRecordingRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
    };

    mockCameraRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    service = new RecordingService(
      mockRecordingRepo,
      mockCameraRepo as any,
      {} as any,
      {} as any,
      {} as any,
      mockRecordingRepo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('sweepStaleOnDemandExtractions', () => {
    it('should fail extractions older than 30 minutes without mux_playback_id', async () => {
      const now = Date.now();
      const thirtyFiveMinutesAgo = new Date(now - 35 * 60 * 1000);
      const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

      const staleRec = {
        id: 'stale-rec-1',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: thirtyFiveMinutesAgo,
        metadata: { extract_attempts: 1 },
      } as unknown as Recording;

      const freshRec = {
        id: 'fresh-rec-2',
        status: 'extracting',
        mux_playback_id: null,
        updated_at: tenMinutesAgo,
      } as unknown as Recording;

      const readyRec = {
        id: 'ready-rec-3',
        status: 'uploaded',
        mux_playback_id: 'mux-123',
        updated_at: thirtyFiveMinutesAgo,
      } as unknown as Recording;

      mockRecordingRepo.find.mockResolvedValue([staleRec, freshRec, readyRec]);

      await service.sweepStaleOnDemandExtractions();

      expect(mockRecordingRepo.update).toHaveBeenCalledTimes(1);
      expect(mockRecordingRepo.update).toHaveBeenCalledWith('stale-rec-1', {
        status: 'failed',
        metadata: expect.objectContaining({
          extract_failed_reason: expect.stringContaining('30 minutes'),
        }),
      });
    });
  });

  describe('requestOnDemandExtraction prior claim stalled recovery', () => {
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
  });
});
