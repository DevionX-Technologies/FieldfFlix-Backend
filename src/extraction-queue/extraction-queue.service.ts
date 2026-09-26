import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, LessThan, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ExtractionJob,
  ExtractionJobStatus,
} from './entities/extraction-job.entity';
import { Recording } from '../recording/entities/recording.entity';
import { ExtractionRequest } from '../recording/entities/extraction-request.entity';
import {
  generateRecordingFingerprint,
  generateR2Key,
} from './recording-fingerprint.util';
import { CloudflareRecordingsService } from '../cloudflare-recordings/cloudflare-recordings.service';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import { ExtractionJobProgressService } from './extraction-job-progress.service';
import { ConfigService } from '@nestjs/config';

/** Statuses that mean a job is currently occupying a Pi extraction slot. */
const ACTIVE_STATUSES: ExtractionJobStatus[] = [
  ExtractionJobStatus.DISPATCHING,
  ExtractionJobStatus.EXTRACTING,
  ExtractionJobStatus.UPLOADING_R2,
];

/**
 * Statuses a job can no longer leave. Used to stop late-arriving Pi responses
 * from resurrecting a job that has already reached a durable outcome.
 */
const TERMINAL_STATUSES: ExtractionJobStatus[] = [
  ExtractionJobStatus.R2_READY,
  ExtractionJobStatus.STREAM_READY,
  ExtractionJobStatus.CANCELLED,
];

export interface QueueExtractionInput {
  userId: string;
  venueId: string; // turfId
  cameraId: string;
  channelNumber: number;
  startTime: Date;
  endTime: Date;
  piBaseUrl: string;
  piApiKey?: string;
  recordingName?: string;
}

export interface QueueExtractionResult {
  extractionRequestId: string;
  recordingId: string;
  jobId: string | null;
  status: 'QUEUED' | 'ATTACHED_TO_EXISTING' | 'ALREADY_READY';
  message: string;
}

@Injectable()
export class ExtractionQueueService {
  private readonly logger = new Logger(ExtractionQueueService.name);

  /**
   * Max extractions in flight PER PI GATEWAY (not global). Each venue Pi pulls
   * from its own NVR, so capacity is bounded per-Pi, not across the fleet.
   * Default 3 — tune down if the Pi/NVR saturates.
   */
  private readonly MAX_CONCURRENCY_PER_PI: number;

  /** A job with no `next_retry_at` (or a due one) is eligible for dispatch. */
  private readonly RETRY_BASE_DELAY_MS = 60 * 1000;
  private readonly MAX_BACKOFF_MS = 30 * 60 * 1000;

  /** Guards against concurrent dispatch passes within this process. */
  private dispatchInFlight = false;

  constructor(
    @InjectRepository(ExtractionJob)
    private readonly jobRepo: Repository<ExtractionJob>,
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectRepository(ExtractionRequest)
    private readonly extractionRequestRepo: Repository<ExtractionRequest>,
    private readonly cloudflareRecordingsService: CloudflareRecordingsService,
    private readonly piApiService: RaspberryPiApiService,
    private readonly progressService: ExtractionJobProgressService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    const raw = Number(
      this.configService.get<string>('EXTRACTION_CONCURRENCY_PER_PI') ?? 3,
    );
    this.MAX_CONCURRENCY_PER_PI =
      Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
    this.logger.log(
      `Extraction queue configured with MAX_CONCURRENCY_PER_PI=${this.MAX_CONCURRENCY_PER_PI}`,
    );
  }

  /**
   * Main entry point for all extraction requests.
   * Handles deduplication, queuing, and returns immediately.
   */
  async queueExtraction(
    input: QueueExtractionInput,
  ): Promise<QueueExtractionResult> {
    const fingerprint = generateRecordingFingerprint({
      venueId: input.venueId,
      cameraId: input.cameraId,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    this.logger.log(
      `[Queue] Fingerprint=${fingerprint} for user=${input.userId}`,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const existingRecording = await manager
          .createQueryBuilder(Recording, 'r')
          .where('r.recording_fingerprint = :fp', { fp: fingerprint })
          .setLock('pessimistic_write')
          .getOne();

        if (existingRecording) {
          return this.attachToExisting(manager, existingRecording, input);
        }

        return this.createNewJob(manager, input, fingerprint);
      });
    } catch (err) {
      // Two concurrent requests can both miss the SELECT above; the unique index
      // on `recording_fingerprint` is the real serialisation point. Surface the
      // winner as a normal dedup hit instead of a 500.
      if (this.isUniqueViolation(err)) {
        this.logger.warn(
          `[Queue] Concurrent duplicate for fingerprint=${fingerprint}; re-reading winner`,
        );
        const winner = await this.recordingRepo.findOne({
          where: { recording_fingerprint: fingerprint },
        });
        if (winner) {
          return {
            extractionRequestId: '',
            recordingId: winner.id,
            jobId: null,
            status: ['r2_ready', 'stream_ready', 'ready'].includes(
              winner.status,
            )
              ? 'ALREADY_READY'
              : 'ATTACHED_TO_EXISTING',
            message:
              'A matching extraction was already created by a concurrent request.',
          };
        }
      }
      throw err;
    }
  }

  private async attachToExisting(
    manager: EntityManager,
    existingRecording: Recording,
    input: QueueExtractionInput,
  ): Promise<QueueExtractionResult> {
    this.logger.log(
      `[Queue] Deduplication hit: Recording ${existingRecording.id} already exists (status=${existingRecording.status})`,
    );

    const extractionRequest = manager.create(ExtractionRequest, {
      recordingId: existingRecording.id,
      userId: input.userId,
      status: 'pending',
    });
    await manager.save(extractionRequest);

    const isReady = ['r2_ready', 'stream_ready', 'ready'].includes(
      existingRecording.status,
    );

    return {
      extractionRequestId: extractionRequest.id,
      recordingId: existingRecording.id,
      jobId: null,
      status: isReady ? 'ALREADY_READY' : 'ATTACHED_TO_EXISTING',
      message: isReady
        ? 'Recording is already available for playback.'
        : `Recording is being extracted (status: ${existingRecording.status}). You will be notified when ready.`,
    };
  }

  private async createNewJob(
    manager: EntityManager,
    input: QueueExtractionInput,
    fingerprint: string,
  ): Promise<QueueExtractionResult> {
    const env = (
      this.configService.get<string>('ENVIRONMENT') === 'production'
        ? 'prod'
        : 'dev'
    ) as 'dev' | 'prod';
    const r2Key = generateR2Key({
      environment: env,
      venueId: input.venueId,
      cameraId: input.cameraId,
      startTime: input.startTime,
      endTime: input.endTime,
      fingerprint,
    });

    const recording = manager.create(Recording, {
      userId: input.userId,
      turfId: input.venueId,
      cameraId: input.cameraId,
      startTime: input.startTime,
      endTime: input.endTime,
      status: 'queued',
      recording_fingerprint: fingerprint,
      recording_name: input.recordingName ?? null,
      s3Path: `r2://${this.configService.get('CLOUDFLARE_R2_BUCKET_NAME')}/${r2Key}`,
      metadata: {
        provider: 'cloudflare',
        r2Key,
        r2Bucket: this.configService.get('CLOUDFLARE_R2_BUCKET_NAME'),
        channelNumber: input.channelNumber,
        piBaseUrl: input.piBaseUrl,
        piApiKey: input.piApiKey,
        queued_at: new Date().toISOString(),
      },
    });
    await manager.save(recording);

    const extractionRequest = manager.create(ExtractionRequest, {
      recordingId: recording.id,
      userId: input.userId,
      status: 'pending',
    });
    await manager.save(extractionRequest);

    const now = new Date();
    const job = manager.create(ExtractionJob, {
      recordingId: recording.id,
      status: ExtractionJobStatus.QUEUED,
      pi_base_url: input.piBaseUrl,
      queued_at: now,
      first_queued_at: now,
    });
    await manager.save(job);

    this.logger.log(
      `[Queue] Created new job=${job.id} for recording=${recording.id}`,
    );

    // Don't make the caller wait for the cron tick.
    void this.wakeDispatcher();

    return {
      extractionRequestId: extractionRequest.id,
      recordingId: recording.id,
      jobId: job.id,
      status: 'QUEUED',
      message:
        'Extraction queued. You will be notified when the video is ready.',
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    const code = (err as { code?: string; driverError?: { code?: string } })
      ?.code;
    const driverCode = (err as { driverError?: { code?: string } })?.driverError
      ?.code;
    return code === '23505' || driverCode === '23505';
  }

  /**
   * The dispatcher. Fast tick — the cron is a safety net, and `wakeDispatcher`
   * handles the hot path. Concurrency is enforced PER PI so a busy venue can
   * never starve the others.
   */
  @Cron('*/2 * * * * *')
  async dispatchNextJob(): Promise<void> {
    if (this.dispatchInFlight) return;
    this.dispatchInFlight = true;
    try {
      // Every Pi with at least one dispatchable job.
      const pending = await this.jobRepo
        .createQueryBuilder('j')
        .select('DISTINCT j.pi_base_url', 'pi')
        .where('j.status = :queued', { queued: ExtractionJobStatus.QUEUED })
        .andWhere('(j.next_retry_at IS NULL OR j.next_retry_at <= :now)', {
          now: new Date(),
        })
        .getRawMany<{ pi: string | null }>();

      if (!pending?.length) return;

      // Active (slot-occupying) job count per Pi, in one query.
      const activeRows = await this.jobRepo
        .createQueryBuilder('j')
        .select('j.pi_base_url', 'pi')
        .addSelect('COUNT(*)', 'active')
        .where({ status: In(ACTIVE_STATUSES) })
        .groupBy('j.pi_base_url')
        .getRawMany<{ pi: string | null; active: string }>();

      const activeByPi = new Map<string, number>();
      for (const row of activeRows) {
        activeByPi.set(row.pi ?? '', Number(row.active));
      }

      for (const row of pending) {
        const pi = row.pi ?? '';
        const active = activeByPi.get(pi) ?? 0;
        const capacity = this.MAX_CONCURRENCY_PER_PI - active;
        for (let i = 0; i < capacity; i++) {
          const claimed = await this.claimNextQueuedJob(pi);
          if (!claimed) break;
          await this.dispatchJob(claimed);
        }
      }
    } catch (err) {
      this.logger.error(
        `[Dispatch] Pass failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.dispatchInFlight = false;
    }
  }

  /**
   * Atomically claims the oldest eligible job for a given Pi. The status-guarded
   * UPDATE is what makes double-dispatch impossible across processes; SKIP LOCKED
   * lets several workers claim different rows without blocking each other.
   */
  private async claimNextQueuedJob(
    piBaseUrl: string,
  ): Promise<ExtractionJob | null> {
    const candidate = await this.jobRepo
      .createQueryBuilder('j')
      .innerJoinAndSelect('j.recording', 'recording')
      .where('j.status = :queued', { queued: ExtractionJobStatus.QUEUED })
      .andWhere('j.pi_base_url = :pi', { pi: piBaseUrl })
      .andWhere('(j.next_retry_at IS NULL OR j.next_retry_at <= :now)', {
        now: new Date(),
      })
      .orderBy('j.first_queued_at', 'ASC', 'NULLS LAST')
      .addOrderBy('j.queued_at', 'ASC')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getOne();

    if (!candidate) return null;

    const now = new Date();
    const res = await this.jobRepo
      .createQueryBuilder()
      .update(ExtractionJob)
      .set({
        status: ExtractionJobStatus.EXTRACTING,
        dispatched_at: now,
        worker_id: this.workerIdFor(piBaseUrl),
        // Best-effort: the Pi starts pulling from the NVR as soon as it acks.
        nvr_download_started_at: candidate.nvr_download_started_at ?? now,
        error_code: null,
        error_message: null,
      })
      .where('id = :id', { id: candidate.id })
      .andWhere('status = :queued', { queued: ExtractionJobStatus.QUEUED })
      .returning('id')
      .execute();

    if (!res.affected) return null; // lost the race, caller will retry

    await this.recordingRepo.update(candidate.recordingId, {
      status: 'extracting',
    });
    return candidate;
  }

  private workerIdFor(piBaseUrl: string): string {
    try {
      return new URL(piBaseUrl).hostname;
    } catch {
      return 'pi-unknown';
    }
  }

  /**
   * Recover stale jobs that have been in an active state for too long. This
   * handles the case where the Pi crashed after we sent the job but before it
   * called back. Also re-arms jobs whose backoff window has elapsed.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async recoverStaleJobs(): Promise<void> {
    const staleMs = Number(
      this.configService.get<string>('EXTRACTION_STALE_AFTER_MS') ??
        45 * 60 * 1000,
    );
    const staleThreshold = new Date(Date.now() - staleMs);

    const staleJobs = await this.jobRepo.find({
      where: [
        {
          status: In([
            ExtractionJobStatus.DISPATCHING,
            ExtractionJobStatus.EXTRACTING,
            ExtractionJobStatus.UPLOADING_R2,
          ]),
          dispatched_at: LessThan(staleThreshold),
        },
      ],
    });

    for (const job of staleJobs) {
      this.logger.warn(
        `[Queue] Stale job detected: job=${job.id}, retrying (attempt ${job.retry_count + 1}/${job.max_retries})`,
      );
      await this.handleJobFailure(
        job,
        'STALE_TIMEOUT',
        'Job became stale - Pi may have crashed or the callback was lost',
      );
    }

    // Nudge the dispatcher in case backoff windows just elapsed.
    void this.wakeDispatcher();
  }

  private async dispatchJob(job: ExtractionJob): Promise<void> {
    const recording = job.recording;
    if (!recording) {
      this.logger.error(`[Dispatch] Recording not found for job=${job.id}`);
      await this.handleJobFailure(
        job,
        'RECORDING_NOT_FOUND',
        'Associated recording not found',
      );
      return;
    }

    const meta = (recording.metadata ?? {}) as Record<string, unknown>;
    const piBaseUrl = job.pi_base_url ?? (meta.piBaseUrl as string | undefined);
    const piApiKey = meta.piApiKey as string | undefined;
    const r2Key = meta.r2Key as string | undefined;

    if (!piBaseUrl || !r2Key) {
      await this.handleJobFailure(
        job,
        'MISSING_CONFIG',
        'Pi URL or R2 key missing from recording metadata',
      );
      return;
    }

    let uploadUrl: string;
    try {
      const uploadInfo =
        await this.cloudflareRecordingsService.generateUploadUrl(r2Key);
      uploadUrl = uploadInfo.uploadUrl;
    } catch (err) {
      this.logger.error(
        `[Dispatch] Failed to generate upload URL for job=${job.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await this.handleJobFailure(
        job,
        'UPLOAD_URL_FAILED',
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    this.logger.log(`[Dispatch] Sending job=${job.id} to Pi at ${piBaseUrl}`);

    // The job is ALREADY EXTRACTING (set atomically during the claim). Every
    // status transition now happens strictly through the handlers below, so a
    // fast Pi rejection can no longer be clobbered by a late status write.
    this.piApiService
      .extractSession(
        piBaseUrl,
        {
          recordingId: recording.id,
          channel: (meta.channelNumber as number) || 1,
          startTime: recording.startTime.toISOString(),
          endTime: recording.endTime.toISOString(),
          uploadUrl,
          s3Key: r2Key,
          callbackWebhookUrl: this.callbackUrl(),
        },
        piApiKey,
      )
      .then(async (response) => {
        if (response?.status === 'SUCCESS') {
          this.logger.log(
            `[Dispatch] Pi reported success for job=${job.id}; verifying with R2`,
          );
          await this.onJobSuccess(job.id, r2Key);
        } else {
          await this.handleJobFailure(
            job,
            'PI_FAILURE',
            response?.error ?? 'Pi returned failure status',
          );
        }
      })
      .catch(async (err: Error) => {
        this.logger.error(
          `[Dispatch] Pi request failed for job=${job.id}: ${err.message}`,
        );
        await this.handleJobFailure(job, 'PI_REQUEST_FAILED', err.message);
      });
  }

  private callbackUrl(): string {
    const base = (
      this.configService.get<string>('BACKEND_CALLBACK_URL') ??
      this.configService.get<string>('APP_BASE_URL') ??
      ''
    ).replace(/\/+$/, '');
    return `${base}/cloudflare-recordings/callback`;
  }

  /** Triggers an immediate dispatch pass without waiting for the cron tick. */
  async wakeDispatcher(): Promise<void> {
    try {
      await this.dispatchNextJob();
    } catch (err) {
      this.logger.warn(
        `[Dispatch] Wake failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Called when the Pi self-reports success. This path has no R2 verification,
   * so it is only accepted from an active state.
   */
  async onJobSuccess(jobId: string, r2Key: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;

    if (TERMINAL_STATUSES.includes(job.status)) {
      this.logger.log(
        `[Queue] Ignoring late success for job=${jobId} in terminal status ${job.status}`,
      );
      return;
    }

    const now = new Date();
    await this.jobRepo.update(
      { id: jobId, status: In(ACTIVE_STATUSES) },
      {
        status: ExtractionJobStatus.R2_READY,
        nvr_download_completed_at: job.nvr_download_completed_at ?? now,
        upload_completed_at: now,
        r2_ready_at: now,
      },
    );

    await this.recordingRepo.update(job.recordingId, { status: 'r2_ready' });
    await this.extractionRequestRepo.update(
      { recordingId: job.recordingId, status: 'pending' },
      { status: 'completed' },
    );

    this.logger.log(`[Queue] Job=${jobId} is R2_READY (r2Key=${r2Key})`);
  }

  /**
   * Marks the R2 object as verified. Called from the signed Pi callback, which
   * has already confirmed the object exists and is non-empty, so this is
   * allowed to recover a job that previously exhausted its retries.
   */
  async onR2Verified(
    recordingId: string,
    details?: {
      nvrDownloadCompletedAt?: Date | null;
      uploadStartedAt?: Date | null;
      uploadCompletedAt?: Date | null;
    },
  ): Promise<void> {
    await this.progressService.onR2Verified(recordingId, details);
    void this.wakeDispatcher();
  }

  async onStreamImportStarted(recordingId: string): Promise<void> {
    await this.progressService.onStreamImportStarted(recordingId);
  }

  /** Invoked from the Cloudflare Stream `video.ready` webhook. */
  async onStreamReady(recordingId: string): Promise<void> {
    await this.progressService.onStreamReady(recordingId);
    void this.wakeDispatcher();
  }

  private async handleJobFailure(
    job: ExtractionJob,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    // Never let a late failure demote a job that already produced a video.
    if (TERMINAL_STATUSES.includes(job.status)) {
      this.logger.log(
        `[Queue] Ignoring late failure for job=${job.id} in terminal status ${job.status} (${errorCode})`,
      );
      return;
    }

    const newRetryCount = job.retry_count + 1;
    const canRetry = newRetryCount <= job.max_retries;

    // Exponential backoff: 2^retry_count minutes, capped.
    const backoffMs = Math.min(
      Math.pow(2, newRetryCount) * this.RETRY_BASE_DELAY_MS,
      this.MAX_BACKOFF_MS,
    );
    const nextRetryAt = canRetry ? new Date(Date.now() + backoffMs) : null;

    await this.jobRepo.update(
      { id: job.id },
      {
        status: canRetry
          ? ExtractionJobStatus.QUEUED
          : ExtractionJobStatus.FAILED,
        retry_count: newRetryCount,
        error_code: errorCode,
        error_message: errorMessage,
        next_retry_at: nextRetryAt,
        failed_at: canRetry ? null : new Date(),
        // `first_queued_at` is intentionally NOT touched: it anchors telemetry.
        queued_at: canRetry ? new Date() : job.queued_at,
      },
    );

    if (!canRetry) {
      await this.recordingRepo.update(job.recordingId, { status: 'failed' });
      await this.extractionRequestRepo.update(
        { recordingId: job.recordingId, status: 'pending' },
        { status: 'failed' },
      );
      this.logger.error(
        `[Queue] Job=${job.id} permanently failed after ${newRetryCount} attempts: ${errorCode}`,
      );
      return;
    }

    await this.recordingRepo.update(job.recordingId, { status: 'queued' });
    this.logger.warn(
      `[Queue] Job=${job.id} will retry in ${Math.round(backoffMs / 60000)} min (attempt ${newRetryCount}/${job.max_retries})`,
    );
  }

  async getJobStatus(recordingId: string): Promise<ExtractionJob | null> {
    return this.jobRepo.findOne({ where: { recordingId } });
  }

  async getPipelineStatus(userId: string): Promise<PipelineStatusEntry[]> {
    const requests = await this.extractionRequestRepo.find({
      where: { userId },
      relations: ['recording'],
      order: { requested_at: 'DESC' },
    });

    const recordingIds = [
      ...new Set(requests.map((r) => r.recordingId).filter(Boolean)),
    ];

    // Single query instead of one per request.
    const jobs = recordingIds.length
      ? await this.jobRepo.find({ where: { recordingId: In(recordingIds) } })
      : [];
    const jobByRecording = new Map(jobs.map((j) => [j.recordingId, j]));

    const now = Date.now();

    return requests.map((req) => {
      const job = jobByRecording.get(req.recordingId) ?? null;
      // Anchor on first_queued_at so retries don't make jobs look instant.
      const anchor = job?.first_queued_at ?? job?.queued_at ?? null;
      const anchorMs = anchor ? new Date(anchor).getTime() : null;

      return {
        extractionRequestId: req.id,
        recordingId: req.recording?.id ?? null,
        recordingName: req.recording?.recording_name ?? null,
        status: req.recording?.status ?? req.status,
        requestedAt: req.requested_at,
        timing: {
          elapsed_seconds:
            anchorMs !== null ? Math.floor((now - anchorMs) / 1000) : null,
          queued_to_dispatch_seconds:
            anchorMs && job?.dispatched_at
              ? Math.floor(
                  (new Date(job.dispatched_at).getTime() - anchorMs) / 1000,
                )
              : null,
          nvr_download_seconds:
            job?.dispatched_at && job?.nvr_download_completed_at
              ? Math.floor(
                  (new Date(job.nvr_download_completed_at).getTime() -
                    new Date(job.dispatched_at).getTime()) /
                    1000,
                )
              : null,
          r2_upload_seconds:
            job?.upload_started_at && job?.upload_completed_at
              ? Math.floor(
                  (new Date(job.upload_completed_at).getTime() -
                    new Date(job.upload_started_at).getTime()) /
                    1000,
                )
              : null,
          r2_ready_seconds:
            anchorMs && job?.r2_ready_at
              ? Math.floor(
                  (new Date(job.r2_ready_at).getTime() - anchorMs) / 1000,
                )
              : null,
          stream_ready_seconds:
            anchorMs && job?.stream_ready_at
              ? Math.floor(
                  (new Date(job.stream_ready_at).getTime() - anchorMs) / 1000,
                )
              : null,
        },
        stages: job
          ? {
              dispatched_at: job.dispatched_at ?? null,
              nvr_download_started_at: job.nvr_download_started_at ?? null,
              nvr_download_completed_at: job.nvr_download_completed_at ?? null,
              upload_started_at: job.upload_started_at ?? null,
              upload_completed_at: job.upload_completed_at ?? null,
              r2_ready_at: job.r2_ready_at ?? null,
              stream_import_started_at: job.stream_import_started_at ?? null,
              stream_ready_at: job.stream_ready_at ?? null,
            }
          : null,
        job: job
          ? {
              id: job.id,
              status: job.status,
              retry_count: job.retry_count,
              max_retries: job.max_retries,
              error_code: job.error_code,
              error_message: job.error_message,
              next_retry_at: job.next_retry_at ?? null,
              pi_base_url: job.pi_base_url ?? null,
              worker_id: job.worker_id ?? null,
              queued_at: job.queued_at,
              first_queued_at: job.first_queued_at,
              r2_ready_at: job.r2_ready_at,
              stream_ready_at: job.stream_ready_at,
            }
          : null,
      };
    });
  }
}

export interface PipelineStatusEntry {
  extractionRequestId: string;
  recordingId: string | null;
  recordingName: string | null;
  status: string;
  requestedAt: Date;
  timing: {
    elapsed_seconds: number | null;
    queued_to_dispatch_seconds: number | null;
    nvr_download_seconds: number | null;
    r2_upload_seconds: number | null;
    r2_ready_seconds: number | null;
    stream_ready_seconds: number | null;
  };
  stages: {
    dispatched_at: Date | null;
    nvr_download_started_at: Date | null;
    nvr_download_completed_at: Date | null;
    upload_started_at: Date | null;
    upload_completed_at: Date | null;
    r2_ready_at: Date | null;
    stream_import_started_at: Date | null;
    stream_ready_at: Date | null;
  } | null;
  job: {
    id: string;
    status: ExtractionJobStatus;
    retry_count: number;
    max_retries: number;
    error_code: string;
    error_message: string;
    next_retry_at: Date | null;
    pi_base_url: string | null;
    worker_id: string | null;
    queued_at: Date;
    first_queued_at: Date;
    r2_ready_at: Date;
    stream_ready_at: Date;
  } | null;
}
