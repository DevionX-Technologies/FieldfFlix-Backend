import { RecordingService } from './recording.service';

describe('RecordingService Live Stream Integration', () => {
  let recordingService: RecordingService;
  let mockCameraRepo: any;
  let mockRaspberryPiApi: any;
  let mockMuxService: any;
  let mockDataSource: any;
  let mockMediaProviderFactory: any;
  let mockLiveProvider: any;

  beforeEach(() => {
    mockCameraRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cam_123',
        name: 'Court 1 Center',
        court_number: 1,
        raspberryPiBaseUrl: 'http://192.168.1.100:8000',
        raspberryPiApiKey: 'test-pi-api-key',
      }),
    };

    mockRaspberryPiApi = {
      startLiveStream: jest.fn().mockResolvedValue({ success: true }),
      stopLiveStream: jest.fn().mockResolvedValue({ success: true }),
    };

    mockMuxService = {
      createLiveStream: jest.fn().mockResolvedValue({
        liveStreamId: 'mux_live_123',
        streamKey: 'mux_key_abc',
        playbackId: 'mux_play_xyz',
        rtmpUrl: 'rtmps://global-live.mux.com:443/app/mux_key_abc',
        playbackUrl: 'https://stream.mux.com/mux_play_xyz.m3u8',
      }),
      disableLiveStream: jest.fn().mockResolvedValue(true),
    };

    mockDataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    mockLiveProvider = {
      createLiveStream: jest.fn().mockResolvedValue({
        providerLiveStreamId: 'cf_live_stream_999',
        liveStreamId: 'cf_live_stream_999',
        streamKey: 'cf_stream_key_888',
        playbackId: 'cf_playback_777',
        rtmpUrl: 'rtmps://live.cloudflare.com:443/live/cf_stream_key_888',
        playbackUrl:
          'https://videodelivery.net/cf_playback_777/manifest/video.m3u8',
        provider: 'cloudflare',
      }),
      deleteLiveStream: jest.fn().mockResolvedValue(true),
    };

    mockMediaProviderFactory = {
      getLiveStreamProvider: jest.fn().mockReturnValue(mockLiveProvider),
    };

    // Instantiate RecordingService with required mocks
    recordingService = new RecordingService(
      {} as any, // recordingRepository
      mockCameraRepo,
      {} as any, // recordingHighlightsRepository
      mockRaspberryPiApi,
      {} as any, // fileServiceService
      {} as any, // recordingRepositoryForMedia
      {} as any, // sharedRecordingRepository
      {} as any, // userRepository
      mockMuxService,
      {} as any, // fireBaseNotificationService
      mockDataSource,
      {} as any, // recordingHighlightEngagementService
      {} as any, // recordingHighlightsService
      {} as any, // paymentRestrictionService
      {} as any, // pointsService
      {} as any, // pricingConfigService
      mockMediaProviderFactory,
    );
  });

  it('starts live stream via MediaProviderFactory Cloudflare provider and commands Pi with Cloudflare RTMPS', async () => {
    const res = await recordingService.startCourtLiveStream({
      cameraId: 'cam_123',
      channel: 1,
    });

    expect(mockMediaProviderFactory.getLiveStreamProvider).toHaveBeenCalled();
    expect(mockLiveProvider.createLiveStream).toHaveBeenCalledWith({
      courtNumber: 1,
      channel: 1,
      cameraId: 'cam_123',
    });

    // Verify Pi receives Cloudflare RTMPS ingest URL
    expect(mockRaspberryPiApi.startLiveStream).toHaveBeenCalledWith(
      'http://192.168.1.100:8000',
      {
        channel: 1,
        rtmpUrl: 'rtmps://live.cloudflare.com:443/live/cf_stream_key_888',
      },
      'test-pi-api-key',
    );

    expect(res.success).toBe(true);
    expect(res.provider).toBe('cloudflare');
    expect(res.liveStreamId).toBe('cf_live_stream_999');
    expect(res.playbackUrl).toBe(
      'https://videodelivery.net/cf_playback_777/manifest/video.m3u8',
    );
  });

  it('stops live stream and deletes it via MediaProviderFactory', async () => {
    await recordingService.stopCourtLiveStream({
      cameraId: 'cam_123',
      channel: 1,
      liveStreamId: 'cf_live_stream_999',
    });

    expect(mockRaspberryPiApi.stopLiveStream).toHaveBeenCalledWith(
      'http://192.168.1.100:8000',
      { channel: 1 },
      'test-pi-api-key',
    );

    expect(mockLiveProvider.deleteLiveStream).toHaveBeenCalledWith(
      'cf_live_stream_999',
    );
  });
});
