import { ExtractionQueueService } from './extraction-queue.service';
import { ExtractionJobStatus } from './entities/extraction-job.entity';

const config: Record<string, string> = {
  EXTRACTION_CONCURRENCY_PER_PI: '3',
  EXTRACTION_STALE_AFTER_MS: String(120 * 60 * 1000),
  EXTRACTION_UNKNOWN_OUTCOME_GRACE_MS: String(45 * 60 * 1000),
};

describe('ExtractionQueueService retry classification', () => {
  let service: ExtractionQueueService;
  const jobRepo = { update: jest.fn(), findOne: jest.fn(), find: jest.fn() };
  const recordingRepo = { update: jest.fn(), find: jest.fn() };
  const requestRepo = { update: jest.fn(), find: jest.fn() };
  const configService = {
    get: (key: string) => config[key],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExtractionQueueService(
      jobRepo as any,
      recordingRepo as any,
      requestRepo as any,
      {} as any,
      {} as any,
      {} as any,
      configService as any,
      {} as any,
    );
  });

  const job = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'job-1',
      recordingId: 'rec-1',
      status: ExtractionJobStatus.EXTRACTING,
      retry_count: 0,
      max_retries: 3,
      queued_at: new Date(),
      ...overrides,
    }) as any;

  const nextDelayMs = () => {
    const update = jobRepo.update.mock.calls[0][1];
    return update.next_retry_at.getTime() - Date.now();
  };

  it('uses a short backoff for a definite device failure', async () => {
    await (service as any).handleJobFailure(
      job(),
      'PI_FAILURE',
      'NVR returned no data for the requested window',
    );

    // 2^1 * RETRY_BASE_DELAY_MS -> a couple of minutes.
    expect(nextDelayMs()).toBeGreaterThan(60_000);
    expect(nextDelayMs()).toBeLessThan(10 * 60_000);
  });

  it('holds an unknown-outcome timeout far longer than a normal backoff', async () => {
    await (service as any).handleJobFailure(
      job(),
      'PI_TRIGGER_TIMEOUT',
      'timeout of 1800000ms exceeded',
      { outcomeUnknown: true },
    );

    // 45 minute grace: the in-flight multi-GB transfer gets time to finish and
    // report back instead of being restarted by a second full extraction.
    expect(nextDelayMs()).toBeGreaterThan(40 * 60_000);
    expect(jobRepo.update.mock.calls[0][1].error_code).toBe(
      'PI_TRIGGER_TIMEOUT',
    );
  });

  it('still fails permanently once retries are exhausted', async () => {
    await (service as any).handleJobFailure(
      job({ retry_count: 3, max_retries: 3 }),
      'PI_TRIGGER_TIMEOUT',
      'timeout',
      { outcomeUnknown: true },
    );

    const update = jobRepo.update.mock.calls[0][1];
    expect(update.status).toBe(ExtractionJobStatus.FAILED);
    expect(update.next_retry_at).toBeNull();
    expect(recordingRepo.update).toHaveBeenCalledWith('rec-1', {
      status: 'failed',
    });
  });

  it('treats a stale job as unknown outcome so the transfer is not restarted', async () => {
    jobRepo.find.mockResolvedValue([
      job({
        status: ExtractionJobStatus.UPLOADING_R2,
        retry_count: 0,
        dispatched_at: new Date(Date.now() - 200 * 60 * 1000),
      }),
    ]);

    await service.recoverStaleJobs();

    const update = jobRepo.update.mock.calls[0][1];
    expect(update.error_code).toBe('STALE_TIMEOUT');
    expect(update.next_retry_at.getTime() - Date.now()).toBeGreaterThan(
      40 * 60_000,
    );
  });

  it('does not treat a fresh in-flight job as stale', async () => {
    // Emulate the `dispatched_at < staleThreshold` predicate TypeORM applies in
    // the query, so the mock returns nothing for a job that is still running.
    jobRepo.find.mockImplementation(async () => {
      const staleThreshold = new Date(Date.now() - 120 * 60 * 1000);
      return [
        job({
          status: ExtractionJobStatus.UPLOADING_R2,
          dispatched_at: new Date(Date.now() - 10 * 60 * 1000),
        }),
      ].filter((j) => j.dispatched_at < staleThreshold);
    });

    await service.recoverStaleJobs();

    expect(jobRepo.update).not.toHaveBeenCalled();
  });

  it('ignores a late failure for a job that already produced a video', async () => {
    await (service as any).handleJobFailure(
      job({ status: ExtractionJobStatus.R2_READY }),
      'PI_TRIGGER_TIMEOUT',
      'timeout',
      { outcomeUnknown: true },
    );

    expect(jobRepo.update).not.toHaveBeenCalled();
  });
});
