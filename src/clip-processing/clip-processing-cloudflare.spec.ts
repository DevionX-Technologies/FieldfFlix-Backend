import { ClipProcessingProcessor } from './clip-processing.processor';

describe('ClipProcessingProcessor Cloudflare Integration', () => {
  let processor: ClipProcessingProcessor;
  let mockDataSource: any;
  let mockQueryRunner: any;
  let mockMediaProviderFactory: any;
  let mockVodProvider: any;

  beforeEach(() => {
    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    mockVodProvider = {
      providerName: 'cloudflare',
      createClip: jest.fn().mockResolvedValue({
        provider: 'cloudflare',
        clipAssetId: 'cf_clip_uid_123',
        playbackId: 'cf_clip_uid_123',
        playbackUrl:
          'https://videodelivery.net/cf_clip_uid_123/manifest/video.m3u8',
        status: 'processing',
      }),
    };

    mockMediaProviderFactory = {
      getVodProvider: jest.fn().mockReturnValue(mockVodProvider),
    };

    processor = new ClipProcessingProcessor(
      mockDataSource,
      mockMediaProviderFactory,
    );
  });

  it('processes highlights and creates clips via Cloudflare Stream for Cloudflare recordings', async () => {
    const recordingId = 'rec_cf_101';

    // Mock DB queries:
    // 1. Advisory lock -> success
    // 2. Actionable highlights query -> 1 highlight
    // 3. Recording query -> cloudflareStreamUid in metadata
    // 4. Optimistic lock update -> success
    // 5. Clip update query -> success
    // 6. Release advisory lock -> success
    mockQueryRunner.query
      .mockResolvedValueOnce([{ acquired: true }]) // tryAcquireAdvisoryLock
      .mockResolvedValueOnce([
        // getActionableHighlights
        {
          id: 'hl_101',
          status: 'pending',
          relativeTimestamp: '02:30',
          lock_version: 1,
        },
      ])
      .mockResolvedValueOnce([
        // recording query
        {
          id: recordingId,
          metadata: {
            provider: 'cloudflare',
            cloudflareStreamUid: 'cf_parent_stream_uid_999',
          },
        },
      ])
      .mockResolvedValueOnce([[], 1]) // setStatusProcessing (result[1] > 0)
      .mockResolvedValueOnce([]) // UPDATE recording_highlights with clip details
      .mockResolvedValueOnce([{ unlocked: true }]); // releaseAdvisoryLock

    const result = await processor.processRecording(recordingId);

    expect(result.status).toBe('completed');
    expect(result.processed).toBe(1);
    expect(mockVodProvider.createClip).toHaveBeenCalledWith({
      parentAssetId: 'cf_parent_stream_uid_999',
      startTimeSeconds: 120, // 150s - 30s backtrack
      endTimeSeconds: 150,
      passthrough: 'hl_101',
    });

    expect(mockQueryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE recording_highlights'),
      expect.arrayContaining(['processing', 'cf_clip_uid_123']),
    );
  });
});
