import { RecordingService } from './recording.service';
import { Recording } from '../entities/recording.entity';

describe('RecordingService Fast-Path & Playability', () => {
  let service: RecordingService;
  let mockRecordingRepo: any;
  let mockMuxService: any;

  beforeEach(() => {
    mockRecordingRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockMuxService = {
      getAssetDetails: jest.fn(),
    };

    // Instantiate with minimal mocks needed for getRecordingById
    service = new RecordingService(
      mockRecordingRepo,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockRecordingRepo,
      {} as any,
      {} as any,
      mockMuxService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('isRecordingMuxPlayable', () => {
    it('should return true when recording status is ready and mux_playback_id is set', () => {
      const recording = {
        status: 'ready',
        mux_playback_id: 'mux-playback-123',
      } as Recording;

      expect(service.isRecordingMuxPlayable(recording)).toBe(true);
    });

    it('should return true when recording status is completed and mux_playback_id is set', () => {
      const recording = {
        status: 'completed',
        mux_playback_id: 'mux-playback-123',
      } as Recording;

      expect(service.isRecordingMuxPlayable(recording)).toBe(true);
    });

    it('should return false when mux_playback_id is missing', () => {
      const recording = {
        status: 'ready',
        mux_playback_id: null,
      } as unknown as Recording;

      expect(service.isRecordingMuxPlayable(recording)).toBe(false);
    });

    it('should return false when status is processing/in_progress', () => {
      const recording = {
        status: 'in_progress',
        mux_playback_id: 'mux-playback-123',
      } as Recording;

      expect(service.isRecordingMuxPlayable(recording)).toBe(false);
    });
  });

  describe('getRecordingById fast path', () => {
    it('should return recording immediately without calling muxService when already playable', async () => {
      const readyRecording = {
        id: 'rec-ready-1',
        status: 'ready',
        mux_playback_id: 'playback-ready-123',
        mux_asset_id: 'asset-123',
      } as Recording;

      mockRecordingRepo.findOne.mockResolvedValue(readyRecording);

      const result = await service.getRecordingById('rec-ready-1');

      expect(result).toBe(readyRecording);
      expect(mockRecordingRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'rec-ready-1' },
        relations: ['user', 'turf', 'camera'],
      });
      // Verifies zero synchronous external Mux API latency for playable videos
      expect(mockMuxService.getAssetDetails).not.toHaveBeenCalled();
    });
  });
});
