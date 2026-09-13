import { RecordingHighlightsService } from './recording-highlight.service';
import { Recording } from 'src/recording/entities/recording.entity';
import { RecordingHighlights } from '../entities/recording-highlights.entity';

describe('RecordingHighlightsService Webhook Handling', () => {
  let service: RecordingHighlightsService;
  let mockDataSource: any;
  let mockQueryRunner: any;
  let mockMuxService: any;

  beforeEach(() => {
    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      manager: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        save: jest.fn(),
      },
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    mockMuxService = {
      updateRecordingWithTimingFromAsset: jest
        .fn()
        .mockResolvedValue(undefined),
    };

    service = new RecordingHighlightsService(
      mockDataSource,
      mockMuxService,
      { enqueueClipProcessing: jest.fn() } as any,
      { sendNotification: jest.fn() } as any,
      { updateSessionStats: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
  });

  it('should use webhookBody.id for idempotency and skip duplicate webhook event', async () => {
    // Mock query runner returning empty array on conflict (duplicate event)
    mockQueryRunner.query.mockResolvedValueOnce([]);

    const webhookBody = {
      id: 'evt_test_unique_123',
      type: 'video.asset.ready',
      data: {
        id: 'asset_123',
        status: 'ready',
      },
      environment: { name: 'production' },
    };

    await service.handleMuxWebhook(webhookBody);

    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO webhook_events'),
      ['evt_test_unique_123', 'video.asset.ready', 'asset_123'],
    );
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('should process video.asset.ready and update recording with webhook playback ID', async () => {
    // Event is new
    mockQueryRunner.query
      .mockResolvedValueOnce([{ id: 1 }]) // idempotency insert
      .mockResolvedValueOnce([]); // status update at end

    const existingRecording = {
      id: 'rec-1',
      mux_asset_id: 'asset_123',
      mux_playback_id: null,
      status: 'extracting',
      userId: 'user-1',
    } as unknown as Recording;

    mockQueryRunner.manager.findOne.mockImplementation(async (entity: any) => {
      if (entity === RecordingHighlights) {
        return null; // Not a highlight clip, so it processes main match recording
      }
      if (entity === Recording) {
        return existingRecording;
      }
      return null;
    });

    const webhookBody = {
      id: 'evt_test_ready_456',
      type: 'video.asset.ready',
      data: {
        id: 'asset_123',
        status: 'ready',
        playback_ids: [
          {
            id: 'playback_val_789',
            policy: 'public',
          },
        ],
      },
      environment: { name: 'production' },
    };

    await service.handleMuxWebhook(webhookBody);

    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
      Recording,
      { id: 'rec-1' },
      expect.objectContaining({
        status: 'ready',
        isVideoCreated: true,
        mux_playback_id: 'playback_val_789',
        mux_media_url: 'https://stream.mux.com/playback_val_789.m3u8',
      }),
    );
  });
});
