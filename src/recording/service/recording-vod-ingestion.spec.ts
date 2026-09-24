import { RecordingService } from './recording.service';

describe('RecordingService VOD Ingestion Integration', () => {
  let recordingService: RecordingService;
  let mockRecordingRepo: any;
  let mockFileService: any;
  let mockMuxService: any;
  let mockMediaProviderFactory: any;
  let mockVodProvider: any;

  beforeEach(() => {
    mockRecordingRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation((r) => Promise.resolve(r)),
    };

    mockFileService = {
      getSignedUrlFromS3: jest
        .fn()
        .mockResolvedValue(
          'https://s3.amazonaws.com/test-bucket/video.mp4?signed=1',
        ),
      findFirstObjectKeyWithPrefix: jest
        .fn()
        .mockResolvedValue('recordings/rec_101_20260924.mp4'),
    };

    mockMuxService = {
      uploadFromS3: jest.fn().mockResolvedValue({ assetId: 'mux_asset_101' }),
      createDirectUpload: jest.fn().mockResolvedValue({
        uploadUrl: 'https://mux.com/upload/direct_101',
        uploadId: 'mux_up_101',
      }),
    };

    mockVodProvider = {
      providerName: 'cloudflare',
      ingestFromUrl: jest.fn().mockResolvedValue({
        provider: 'cloudflare',
        assetId: 'cf_vod_stream_999',
        providerAssetId: 'cf_vod_stream_999',
        playbackId: 'cf_vod_stream_999',
        playbackUrl:
          'https://videodelivery.net/cf_vod_stream_999/manifest/video.m3u8',
        status: 'processing',
      }),
      createDirectUpload: jest.fn().mockResolvedValue({
        uploadUrl: 'https://upload.videodelivery.net/direct_cf_999',
        uploadId: 'cf_up_999',
      }),
    };

    mockMediaProviderFactory = {
      getVodProvider: jest.fn().mockReturnValue(mockVodProvider),
    };

    recordingService = new RecordingService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockFileService,
      mockRecordingRepo, // recordingRepositoryForMedia
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
      mockMediaProviderFactory,
    );
  });

  it('ingests video to Cloudflare Stream via /stream/copy when VOD provider is cloudflare', async () => {
    const recordingId = 'rec_101';
    mockRecordingRepo.findOne.mockResolvedValue({
      id: recordingId,
      status: 'uploaded',
      s3Path: 's3://test-bucket/recordings/rec_101_20260924.mp4',
      metadata: {},
    });

    const result = await recordingService.retryMuxIngestion(recordingId);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('cloudflare_ingest_started');
    expect(mockVodProvider.ingestFromUrl).toHaveBeenCalledWith(
      'https://s3.amazonaws.com/test-bucket/video.mp4?signed=1',
      {
        recordingId: 'rec_101',
        metadata: {
          key: 'recordings/rec_101_20260924.mp4',
          recordingId: 'rec_101',
        },
      },
    );

    expect(mockRecordingRepo.update).toHaveBeenCalledWith(
      recordingId,
      expect.objectContaining({
        status: 'processing',
        metadata: expect.objectContaining({
          provider: 'cloudflare',
          cloudflareStreamUid: 'cf_vod_stream_999',
          cloudflarePlaybackUrl:
            'https://videodelivery.net/cf_vod_stream_999/manifest/video.m3u8',
        }),
      }),
    );
  });

  it('ingests video to Mux when VOD provider is mux', async () => {
    mockVodProvider.providerName = 'mux';
    const recordingId = 'rec_102';
    mockRecordingRepo.findOne.mockResolvedValue({
      id: recordingId,
      status: 'uploaded',
      s3Path: 's3://test-bucket/recordings/rec_102_20260924.mp4',
      metadata: {},
    });

    const result = await recordingService.retryMuxIngestion(recordingId);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('mux_upload_started');
    expect(mockMuxService.uploadFromS3).toHaveBeenCalledWith(
      'https://s3.amazonaws.com/test-bucket/video.mp4?signed=1',
      'recordings/rec_102_20260924.mp4',
      'rec_102',
    );
  });

  it('handles Pi extraction callback SUCCESS and triggers VOD ingestion', async () => {
    const recordingId = 'rec_103';
    mockRecordingRepo.findOne.mockResolvedValue({
      id: recordingId,
      status: 'extracting',
      s3Path: null,
      metadata: {},
    });

    const callbackRes = await recordingService.handlePiExtractionCallback({
      recordingId,
      status: 'SUCCESS',
      s3Key: 'recordings/rec_103_20260924.mp4',
    } as any);

    expect(callbackRes.success).toBe(true);
    expect(mockRecordingRepo.update).toHaveBeenCalledWith(
      recordingId,
      expect.objectContaining({
        status: 'uploaded',
        s3Path: expect.stringContaining('recordings/rec_103_20260924.mp4'),
      }),
    );
  });
});
