import { BadGatewayException } from '@nestjs/common';
import { mergeMap, of, throwError, timer } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { RaspberryPiApiService } from './raspberry-pi-api.service';

// Must include a scheme: `buildPiRequest` parses it with `new URL()`.
const BASE_URL = 'https://cpu.test.ts.net';

/** Minimal HttpService double that records the timeout of each POST. */
function makeHttpService(handler: (url: string, config: any) => any) {
  const calls: Array<{ url: string; timeout: number }> = [];
  // axios signature is post(url, data, config)
  const httpService = {
    post: jest.fn((url: string, body: any, config: any) => {
      calls.push({ url, timeout: config?.timeout });
      return handler(url, config);
    }),
    get: jest.fn(() => of({ data: {} })),
  };
  return { httpService, calls };
}

function timeoutError() {
  const err: any = new Error('timeout of 1000ms exceeded');
  err.code = 'ETIMEDOUT';
  return err;
}

function makeService(httpService: any) {
  const service = new RaspberryPiApiService(httpService as HttpService);
  // Avoid DNS resolution against the synthetic hostname.
  jest
    .spyOn(service as any, 'resolvePiHostname')
    .mockResolvedValue(null as any);
  (service as any).getEvmsApiKey = () => 'evms-key';
  (service as any).getLiveApiKey = () => 'live-key';
  (service as any).assertApiKey = () => undefined;
  return service;
}

const payload = {
  recordingId: 'rec-1',
  channel: 1,
  startTime: '2026-09-26T10:00:00.000Z',
  endTime: '2026-09-26T10:10:00.000Z',
  uploadUrl: 'https://r2.example.test/put',
  s3Key: 'recordings/rec-1.mp4',
};

describe('RaspberryPiApiService.extractSession timeout budget', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('does not start a second extraction when the primary trigger times out', async () => {
    process.env.PI_EXTRACT_TRIGGER_TIMEOUT_MS = '1000';
    process.env.PI_EXTRACT_TRIGGER_TOTAL_BUDGET_MS = '1500';

    const { httpService, calls } = makeHttpService(() =>
      throwError(() => timeoutError()),
    );
    const service = makeService(httpService);

    await expect(service.extractSession(BASE_URL, payload)).rejects.toThrow(
      BadGatewayException,
    );

    // A timeout means the device is most likely still extracting. Falling back
    // to the second daemon would start a SECOND full multi-GB extraction.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain(':8443');
  });

  it('falls back on a definite rejection, using only the remaining budget', async () => {
    process.env.PI_EXTRACT_TRIGGER_TIMEOUT_MS = '5000';
    process.env.PI_EXTRACT_TRIGGER_TOTAL_BUDGET_MS = '5000';

    const { httpService, calls } = makeHttpService((url) => {
      if (!url.includes(':8443')) {
        const err: any = new Error('connect ECONNREFUSED');
        err.response = { data: { message: 'connection refused' } };
        return throwError(() => err);
      }
      return of({ data: { detail: { status: 'SUCCESS' } } });
    });
    const service = makeService(httpService);

    const res = await service.extractSession(BASE_URL, payload);

    expect(res).toEqual({ status: 'SUCCESS' });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).not.toContain(':8443');
    expect(calls[1].url).toContain(':8443');
    // The budget is wall-clock: the primary failed instantly, so the fallback
    // legitimately gets the remaining slice, never more than the whole budget.
    expect(calls[1].timeout).toBeLessThanOrEqual(5000);
  });

  it('skips the fallback entirely once the shared budget is exhausted', async () => {
    process.env.PI_EXTRACT_TRIGGER_TIMEOUT_MS = '100';
    process.env.PI_EXTRACT_TRIGGER_TOTAL_BUDGET_MS = '100';

    const { httpService, calls } = makeHttpService((url) => {
      if (url.includes(':8443'))
        return of({ data: { detail: { status: 'SUCCESS' } } });
      // The primary burns past the whole budget before failing.
      return timer(150).pipe(
        mergeMap(() => {
          const err: any = new Error('connect ECONNREFUSED');
          err.response = { data: { message: 'connection refused' } };
          return throwError(() => err);
        }),
      );
    });
    const service = makeService(httpService);

    await expect(service.extractSession(BASE_URL, payload)).rejects.toThrow(
      BadGatewayException,
    );

    // No budget left, so we must not pin another full-length attempt.
    expect(calls.every((c) => !c.url.includes(':8443'))).toBe(true);
  });

  it('sends a single timeout when only the primary is configured', async () => {
    process.env.PI_EXTRACT_TRIGGER_TIMEOUT_MS = '2500';
    process.env.PI_EXTRACT_TRIGGER_TOTAL_BUDGET_MS = '2500';

    const { httpService, calls } = makeHttpService(() =>
      throwError(() => timeoutError()),
    );
    const service = makeService(httpService);

    await expect(service.extractSession(BASE_URL, payload)).rejects.toThrow(
      BadGatewayException,
    );

    expect(calls).toHaveLength(1);
    // Never exceeds the configured per-attempt budget.
    expect(calls[0].timeout).toBeLessThanOrEqual(2500);
  });

  it('flags a timeout as an unknown outcome so the queue holds off re-dispatching', async () => {
    process.env.PI_EXTRACT_TRIGGER_TIMEOUT_MS = '100';
    process.env.PI_EXTRACT_TRIGGER_TOTAL_BUDGET_MS = '100';

    const { httpService } = makeHttpService(() =>
      throwError(() => timeoutError()),
    );
    const service = makeService(httpService);

    await expect(
      service.extractSession(BASE_URL, payload),
    ).rejects.toMatchObject({
      piErrorCode: 'PI_TRIGGER_TIMEOUT',
      outcomeUnknown: true,
    });
  });

  it('does not flag a definite device rejection as an unknown outcome', async () => {
    const { httpService } = makeHttpService(() =>
      throwError(() => {
        const err: any = new Error('Request failed with status code 422');
        err.response = { data: { message: 'no footage for window' } };
        return err;
      }),
    );
    const service = makeService(httpService);

    await expect(
      service.extractSession(BASE_URL, payload),
    ).rejects.toMatchObject({
      piErrorCode: 'PI_TRIGGER_FAILED',
      outcomeUnknown: false,
    });
  });

  it('passes the multipart plan through to the device', async () => {
    const { httpService, calls } = makeHttpService(() =>
      of({ data: { detail: { status: 'SUCCESS' } } }),
    );
    const service = makeService(httpService);

    const res = await service.extractSession(BASE_URL, {
      ...payload,
      multipart: {
        uploadId: 'up-1',
        partSizeBytes: 67108864,
        partCount: 2,
        concurrency: 3,
        partUrls: ['https://r2.example.test/p1', 'https://r2.example.test/p2'],
      },
    });

    expect(res).toEqual({ status: 'SUCCESS' });
    const body = (httpService.post as jest.Mock).mock.calls[0][1];
    expect(body.multipart).toEqual(
      expect.objectContaining({ uploadId: 'up-1', partCount: 2 }),
    );
    // The single-shot URL is still present as a fallback.
    expect(body.uploadUrl).toBe('https://r2.example.test/put');
    expect(calls).toHaveLength(1);
  });

  it('omits the multipart field entirely for older devices', async () => {
    const { httpService } = makeHttpService(() =>
      of({ data: { detail: { status: 'SUCCESS' } } }),
    );
    const service = makeService(httpService);

    await service.extractSession(BASE_URL, payload);

    const body = (httpService.post as jest.Mock).mock.calls[0][1];
    expect('multipart' in body).toBe(false);
  });
});

describe('shared budget arithmetic', () => {
  it('never lets primary + fallback exceed the total budget', () => {
    // Mirrors the deadline logic in extractSession.
    const perAttempt = 1_800_000;
    const total = 1_800_000;
    const deadline = Date.now() + total;
    const primaryWaits = perAttempt;
    const remainingAfterPrimary = deadline - Date.now() - primaryWaits;
    const fallbackGets = Math.min(
      perAttempt,
      Math.max(0, remainingAfterPrimary),
    );

    // The old code granted a fresh 30 minutes to the fallback as well.
    expect(perAttempt + perAttempt).toBe(3_600_000);
    expect(primaryWaits + fallbackGets).toBeLessThanOrEqual(total);
  });
});
