import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { CloudflareRecordingsService } from './cloudflare-recordings.service';

const CALLBACK_SECRET = 'test-pi-callback-secret';

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
  const jobProgress = {
    onR2Verified: jest.fn(),
    onStreamImportStarted: jest.fn(),
    onStreamReady: jest.fn(),
    onTerminalFailure: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'CLOUDFLARE_R2_BUCKET_NAME') return 'dev-bucket';
      if (key === 'APP_BASE_URL') return 'https://dev-api.example.test';
      if (key === 'PI_CALLBACK_SECRET') return CALLBACK_SECRET;
      return undefined;
    }),
  };

  /**
   * Mimics a venue Pi: serialise the payload once, sign `${ts}.${body}`, and
   * return both the DTO and the signed headers.
   */
  function signedCallback(payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha256', CALLBACK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    return {
      dto: payload as any,
      rawBody: body,
      signature,
      timestamp: String(timestamp),
    };
  }

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
      jobProgress as any,
    );
  });

  const call = (cb: ReturnType<typeof signedCallback>) =>
    service.handleCallback(cb.dto, cb.rawBody, cb.signature, cb.timestamp);

  it('rejects an unsigned callback', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());

    await expect(
      service.handleCallback({
        recordingId: 'recording-1',
        status: 'FAILED',
      } as any),
    ).rejects.toThrow(UnauthorizedException);

    // The core A5 regression: an unsigned FAILED callback must not mark anything.
    expect(recordingRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a callback with a tampered body', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());
    const cb = signedCallback({
      recordingId: 'recording-1',
      status: 'FAILED',
    });

    await expect(
      service.handleCallback(
        cb.dto,
        '{"recordingId":"other"}',
        cb.signature,
        cb.timestamp,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(recordingRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a stale signature outside the replay window', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());
    const body = JSON.stringify({
      recordingId: 'recording-1',
      status: 'FAILED',
    });
    const old = Math.floor(Date.now() / 1000) - 3600;
    const signature = crypto
      .createHmac('sha256', CALLBACK_SECRET)
      .update(`${old}.${body}`)
      .digest('hex');

    await expect(
      service.handleCallback(
        { recordingId: 'recording-1', status: 'FAILED' } as any,
        body,
        signature,
        String(old),
      ),
    ).rejects.toThrow('Callback signature has expired');
  });

  it('rejects a callback whose r2Key does not match the request', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());

    await expect(
      call(
        signedCallback({
          recordingId: 'recording-1',
          status: 'SUCCESS',
          r2Key: 'recordings/somebody-elses-video.mp4',
        }),
      ),
    ).rejects.toThrow('R2 object key does not match the request');
    expect(r2Adapter.headObject).not.toHaveBeenCalled();
  });

  it('keeps a callback processing when the R2 object is missing', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());
    r2Adapter.headObject.mockResolvedValue(null);

    const result = await call(
      signedCallback({ recordingId: 'recording-1', status: 'SUCCESS' }),
    );

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

    const result = await call(
      signedCallback({
        recordingId: 'recording-1',
        status: 'SUCCESS',
        durationSeconds: 300,
      }),
    );

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
    expect(jobProgress.onR2Verified).toHaveBeenCalledWith(
      'recording-1',
      expect.anything(),
    );
    expect(jobProgress.onStreamImportStarted).toHaveBeenCalledWith(
      'recording-1',
    );
  });

  it('does not write Cloudflare Stream values into the Mux columns', async () => {
    recordingRepository.findOne.mockResolvedValue(makeRecording());
    r2Adapter.headObject.mockResolvedValue({ sizeBytes: 5000000 });
    r2Adapter.generateDownloadPresignedUrl.mockResolvedValue({
      downloadUrl: 'https://dev-r2.example.test/signed',
    });
    streamAdapter.createAssetFromUrl.mockResolvedValue({
      assetId: 'cf-stream-9',
      playbackId: 'cf-stream-9',
      playbackUrl: 'https://videodelivery.net/cf-stream-9/manifest/video.m3u8',
      status: 'processing',
    });

    await call(
      signedCallback({ recordingId: 'recording-1', status: 'SUCCESS' }),
    );

    for (const c of recordingRepository.update.mock.calls) {
      expect(c[1]).not.toHaveProperty('mux_playback_id');
      expect(c[1]).not.toHaveProperty('mux_media_url');
    }
    expect(recordingRepository.update).toHaveBeenCalledWith(
      'recording-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          cloudflareStreamUid: 'cf-stream-9',
        }),
      }),
    );
  });

  it('ignores a failure callback for a recording that is already playable', async () => {
    recordingRepository.findOne.mockResolvedValue(
      makeRecording({ status: 'stream_ready' }),
    );
    jobProgress.onTerminalFailure.mockResolvedValue({
      applied: false,
      reason: 'already_STREAM_READY',
    });

    const result = await call(
      signedCallback({
        recordingId: 'recording-1',
        status: 'FAILED',
        error: 'late failure',
      }),
    );

    expect(result.success).toBe(false);
    expect(recordingRepository.update).not.toHaveBeenCalled();
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
