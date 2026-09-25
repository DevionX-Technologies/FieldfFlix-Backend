import { ForbiddenException } from '@nestjs/common';
import { CloudflareRecordingsService } from './cloudflare-recordings.service';

function makeRecording(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recording-1',
    userId: 'user-1',
    status: 'extracting',
    s3Path: 'r2://dev-bucket/recordings/recording-1.mp4',
    startTime: new Date('2026-09-25T11:15:00.000Z'),
    endTime: new Date('2026-09-25T11:20:00.000Z'),
    metadata: {
      provider: 'cloudflare',
      r2Bucket: 'dev-bucket',
      r2Key: 'recordings/recording-1.mp4',
      r2Status: 'uploading',
    },
    sharedRecordings: [],
    ...overrides,
  } as any;
}

describe('CloudflareRecordingsService', () => {
  let service: CloudflareRecordingsService;
  const recordingRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const cameraRepository = { findOne: jest.fn() };
  const sharedRecordingRepository = {};
  const r2Adapter = {
    headObject: jest.fn(),
    generateUploadPresignedUrl: jest.fn(),
    generateDownloadPresignedUrl: jest.fn(),
  };
  const streamAdapter = { createAssetFromUrl: jest.fn() };
  const piApi = { extractSession: jest.fn() };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'CLOUDFLARE_R2_BUCKET_NAME'
        ? 'dev-bucket'
        : key === 'APP_BASE_URL'
          ? 'https://dev-api.example.test'
          : undefined,
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloudflareRecordingsService(
      recordingRepository as any,
      cameraRepository as any,
      sharedRecordingRepository as any,
      r2Adapter as any,
      streamAdapter as any,
      piApi as any,
      configService as any,
    );
  });

  it('keeps a callback processing when the R2 object is missing', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());
    r2Adapter.headObject.mockResolvedValue(null);

    const result = await service.handleCallback({
      recordingId: 'recording-1',
      status: 'SUCCESS',
    });

    expect(result).toEqual({
      success: false,
      status: 'verification_pending',
    });
    expect(recordingRepository.update).toHaveBeenCalledWith(
      'recording-1',
      expect.objectContaining({ status: 'processing' }),
    );
    expect(streamAdapter.createAssetFromUrl).not.toHaveBeenCalled();
  });

  it('marks a non-empty R2 object ready and starts Stream ingestion', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());
    r2Adapter.headObject.mockResolvedValue({
      sizeBytes: 5000000,
      key: 'recordings/recording-1.mp4',
      bucket: 'dev-bucket',
    });
    r2Adapter.generateDownloadPresignedUrl.mockResolvedValue({
      downloadUrl: 'https://dev-r2.example.test/signed',
    });
    streamAdapter.createAssetFromUrl.mockResolvedValue({
      assetId: 'stream-1',
      playbackId: 'stream-1',
      playbackUrl: 'https://videodelivery.net/stream-1/manifest/video.m3u8',
      status: 'processing',
    });

    const result = await service.handleCallback({
      recordingId: 'recording-1',
      status: 'SUCCESS',
      durationSeconds: 300,
    });

    expect(result).toEqual({
      success: true,
      status: 'ready',
      r2Verified: true,
    });
    expect(recordingRepository.update).toHaveBeenCalledWith(
      'recording-1',
      expect.objectContaining({
        status: 'ready',
        metadata: expect.objectContaining({
          r2VerifiedAt: expect.any(String),
          r2ObjectSizeBytes: 5000000,
        }),
      }),
    );
    expect(streamAdapter.createAssetFromUrl).toHaveBeenCalled();
  });

  it('rejects playback for a user without recording access', async () => {
    recordingRepository.findOne.mockResolvedValue(
      makeRecording({ userId: 'different-user' }),
    );

    await expect(service.getPlayback('recording-1', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns playback only after R2 verification', async () => {
    recordingRepository.findOne.mockResolvedValue(
      makeRecording({
        status: 'ready',
        metadata: {
          r2Bucket: 'dev-bucket',
          r2Key: 'recordings/recording-1.mp4',
          r2VerifiedAt: '2026-09-25T11:21:00.000Z',
          r2Status: 'ready',
        },
      }),
    );
    r2Adapter.headObject.mockResolvedValue({ sizeBytes: 5000000 });
    r2Adapter.generateDownloadPresignedUrl.mockResolvedValue({
      downloadUrl: 'https://dev-r2.example.test/signed',
    });

    const result = await service.getPlayback('recording-1', 'user-1');

    expect(result.activeProvider).toBe('CLOUDFLARE_R2');
    expect(result.activeUrl).toBe('https://dev-r2.example.test/signed');
    expect(result.r2.available).toBe(true);
  });
});
