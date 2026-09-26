import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExtractionJob, ExtractionJobStatus } from './entities/extraction-job.entity';
import { Recording } from '../recording/entities/recording.entity';
import { ExtractionRequest } from '../recording/entities/extraction-request.entity';
import { generateRecordingFingerprint, generateR2Key } from './recording-fingerprint.util';
import { CloudflareRecordingsService } from '../cloudflare-recordings/cloudflare-recordings.service';
import { RaspberryPiApiService } from '../raspberry-pi/raspberry-pi-api.service';
import { ConfigService } from '@nestjs/config';

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
  // Max concurrent jobs per Pi worker. Make configurable later.
  private readonly MAX_CONCURRENCY = 1;

  constructor(
    @InjectRepository(ExtractionJob)
    private readonly jobRepo: Repository<ExtractionJob>,
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectRepository(ExtractionRequest)
    private readonly extractionRequestRepo: Repository<ExtractionRequest>,
    private readonly cloudflareRecordingsService: CloudflareRecordingsService,
    private readonly piApiService: RaspberryPiApiService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Main entry point for all extraction requests.
   * Handles deduplication, queuing, and returns immediately.
   */
  async queueExtraction(input: QueueExtractionInput): Promise<QueueExtractionResult> {
    const fingerprint = generateRecordingFingerprint({
      venueId: input.venueId,
      cameraId: input.cameraId,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    this.logger.log(`[Queue] Fingerprint=${fingerprint} for user=${input.userId}`);

    // Use a DB transaction with advisory lock to prevent race conditions
    return await this.dataSource.transaction(async (manager) => {
      // Lock the row for this fingerprint to prevent concurrent duplicates
      const existingRecording = await manager
        .createQueryBuilder(Recording, 'r')
        .where('r.recording_fingerprint = :fp', { fp: fingerprint })
        .setLock('pessimistic_write')
        .getOne();

      // --- CASE A & B & C: Recording already exists ---
      if (existingRecording) {
        this.logger.log(
          `[Queue] Deduplication hit: Recording ${existingRecording.id} already exists (status=${existingRecording.status})`,
        );

        const extractionRequest = manager.create(ExtractionRequest, {
          recordingId: existingRecording.id,
          userId: input.userId,
          status: 'pending',
        });
        await manager.save(extractionRequest);

        const isReady = ['r2_ready', 'stream_ready', 'ready'].includes(existingRecording.status);

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

      // --- CASE D: New recording needed ---
      const env = (this.configService.get<string>('ENVIRONMENT') === 'production' ? 'prod' : 'dev') as 'dev' | 'prod';
      const r2Key = generateR2Key({
        environment: env,
        venueId: input.venueId,
        cameraId: input.cameraId,
        startTime: input.startTime,
        endTime: input.endTime,
        fingerprint,
      });

      // Create the physical recording asset
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

      // Create user's extraction request
      const extractionRequest = manager.create(ExtractionRequest, {
        recordingId: recording.id,
        userId: input.userId,
        status: 'pending',
      });
      await manager.save(extractionRequest);

      // Create the extraction job
      const job = manager.create(ExtractionJob, {
        recordingId: recording.id,
        status: ExtractionJobStatus.QUEUED,
        queued_at: new Date(),
      });
      await manager.save(job);

      this.logger.log(`[Queue] Created new job=${job.id} for recording=${recording.id}`);

      return {
        extractionRequestId: extractionRequest.id,
        recordingId: recording.id,
        jobId: job.id,
        status: 'QUEUED',
        message: 'Extraction queued. You will be notified when the video is ready.',
      };
    });
  }

  /**
   * The dispatcher. Runs every 15 seconds.
   * Checks if any Pi worker is free and dispatches the next QUEUED job.
   */
  @Cron('*/15 * * * * *')
  async dispatchNextJob(): Promise<void> {
    // Check how many jobs are currently being processed (DISPATCHING or EXTRACTING or UPLOADING)
    const activeJobCount = await this.jobRepo.count({
      where: [
        { status: ExtractionJobStatus.DISPATCHING },
        { status: ExtractionJobStatus.EXTRACTING },
        { status: ExtractionJobStatus.UPLOADING_R2 },
      ],
    });

    if (activeJobCount >= this.MAX_CONCURRENCY) {
      return; // Pi is busy, wait
    }

    // Find the oldest QUEUED job (FIFO)
    const nextJob = await this.jobRepo.findOne({
      where: { status: ExtractionJobStatus.QUEUED },
      relations: ['recording'],
      order: { queued_at: 'ASC' },
    });

    if (!nextJob) {
      return; // Nothing queued
    }

    await this.dispatchJob(nextJob);
  }

  /**
   * Recover stale jobs that have been DISPATCHING for more than 35 minutes.
   * This handles the case where the Pi crashed after we sent the job but before completion.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverStaleJobs(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 35 * 60 * 1000); // 35 min

    const staleJobs = await this.jobRepo.find({
      where: [
        { status: ExtractionJobStatus.DISPATCHING, dispatched_at: LessThan(staleThreshold) },
        { status: ExtractionJobStatus.EXTRACTING, dispatched_at: LessThan(staleThreshold) },
      ],
    });

    for (const job of staleJobs) {
      this.logger.warn(`[Queue] Stale job detected: job=${job.id}, retrying (attempt ${job.retry_count + 1}/${job.max_retries})`);
      await this.handleJobFailure(job, 'STALE_TIMEOUT', 'Job became stale - Pi may have crashed');
    }
  }

  private async dispatchJob(job: ExtractionJob): Promise<void> {
    const recording = job.recording;
    if (!recording) {
      this.logger.error(`[Dispatch] Recording not found for job=${job.id}`);
      await this.handleJobFailure(job, 'RECORDING_NOT_FOUND', 'Associated recording not found');
      return;
    }

    // Mark as DISPATCHING immediately to prevent double-dispatch
    await this.jobRepo.update(job.id, {
      status: ExtractionJobStatus.DISPATCHING,
      dispatched_at: new Date(),
      worker_id: 'pi-primary',
    });
    await this.recordingRepo.update(recording.id, { status: 'extracting' });

    const meta = (recording.metadata ?? {}) as Record<string, unknown>;
    const piBaseUrl = meta.piBaseUrl as string | undefined;
    const piApiKey = meta.piApiKey as string | undefined;
    const r2Key = meta.r2Key as string | undefined;

    if (!piBaseUrl || !r2Key) {
      await this.handleJobFailure(job, 'MISSING_CONFIG', 'Pi URL or R2 key missing from recording metadata');
      return;
    }

    try {
      // Generate a fresh presigned upload URL (short-lived, just for this dispatch)
      const uploadInfo = await this.cloudflareRecordingsService.generateUploadUrl(r2Key);

      this.logger.log(`[Dispatch] Sending job=${job.id} to Pi at ${piBaseUrl}`);

      // Fire and forget - do NOT await the long-running Pi extraction
      // The Pi will call our callback webhook when done
      this.piApiService
        .extractSession(
          piBaseUrl,
          {
            recordingId: recording.id,
            channel: (meta.channelNumber as number) || 1,
            startTime: recording.startTime.toISOString(),
            endTime: recording.endTime.toISOString(),
            uploadUrl: uploadInfo.uploadUrl,
            s3Key: r2Key,
            callbackWebhookUrl:
              this.configService.get<string>('BACKEND_CALLBACK_URL') +
              '/cloudflare-recordings/callback',
          },
          piApiKey,
        )
        .then(async (response) => {
          this.logger.log(`[Dispatch] Pi completed job=${job.id} synchronously, processing response`);
          // Pi responded synchronously - trigger callback ourselves
          if (response?.status === 'SUCCESS') {
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
          this.logger.error(`[Dispatch] Pi request failed for job=${job.id}: ${err.message}`);
          await this.handleJobFailure(job, 'PI_REQUEST_FAILED', err.message);
        });

      // Update to EXTRACTING now that Pi has acknowledged
      await this.jobRepo.update(job.id, {
        status: ExtractionJobStatus.EXTRACTING,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Dispatch] Failed to generate upload URL for job=${job.id}: ${message}`);
      await this.handleJobFailure(job, 'UPLOAD_URL_FAILED', message);
    }
  }

  async onJobSuccess(jobId: string, r2Key: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;

    await this.jobRepo.update(jobId, {
      status: ExtractionJobStatus.R2_READY,
      r2_ready_at: new Date(),
      upload_completed_at: new Date(),
    });
    await this.recordingRepo.update(job.recordingId, { status: 'r2_ready' });
    await this.extractionRequestRepo.update(
      { recordingId: job.recordingId },
      { status: 'completed' },
    );

    this.logger.log(`[Queue] Job=${jobId} is R2_READY (r2Key=${r2Key})`);
  }

  async onStreamReady(recordingId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { recordingId } });
    if (!job) return;

    await this.jobRepo.update(job.id, {
      status: ExtractionJobStatus.STREAM_READY,
      stream_ready_at: new Date(),
    });
    await this.recordingRepo.update(recordingId, { status: 'stream_ready' });
    this.logger.log(`[Queue] Recording=${recordingId} is STREAM_READY`);
  }

  private async handleJobFailure(
    job: ExtractionJob,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const newRetryCount = job.retry_count + 1;
    const canRetry = newRetryCount <= job.max_retries;

    // Exponential backoff: 2^retry_count minutes
    const backoffMs = Math.pow(2, newRetryCount) * 60 * 1000;
    const nextRetryAt = canRetry ? new Date(Date.now() + backoffMs) : null;

    await this.jobRepo.update(job.id, {
      status: canRetry ? ExtractionJobStatus.QUEUED : ExtractionJobStatus.FAILED,
      retry_count: newRetryCount,
      error_code: errorCode,
      error_message: errorMessage,
      next_retry_at: nextRetryAt ?? undefined,
      failed_at: canRetry ? undefined : new Date(),
      queued_at: canRetry ? new Date() : job.queued_at,
    });

    if (!canRetry) {
      await this.recordingRepo.update(job.recordingId, { status: 'failed' });
      await this.extractionRequestRepo.update(
        { recordingId: job.recordingId },
        { status: 'failed' },
      );
      this.logger.error(
        `[Queue] Job=${job.id} permanently failed after ${newRetryCount} attempts: ${errorCode}`,
      );
    } else {
      await this.recordingRepo.update(job.recordingId, { status: 'queued' });
      this.logger.warn(
        `[Queue] Job=${job.id} will retry in ${backoffMs / 60000} min (attempt ${newRetryCount}/${job.max_retries})`,
      );
    }
  }

  async getJobStatus(recordingId: string): Promise<ExtractionJob | null> {
    return this.jobRepo.findOne({ where: { recordingId } });
  }

  async getPipelineStatus(userId: string): Promise<PipelineStatusEntry[]> {
    // Return all extraction requests for a user with job timing info
    const requests = await this.extractionRequestRepo.find({
      where: { userId },
      relations: ['recording'],
      order: { requested_at: 'DESC' },
    });

    const results: PipelineStatusEntry[] = [];
    for (const req of requests) {
      const job = req.recording
        ? await this.jobRepo.findOne({ where: { recordingId: req.recording.id } })
        : null;

      const now = Date.now();
      const queuedAt = job?.queued_at?.getTime();
      const r2ReadyAt = job?.r2_ready_at?.getTime();
      const streamReadyAt = job?.stream_ready_at?.getTime();

      results.push({
        extractionRequestId: req.id,
        recordingId: req.recording?.id ?? null,
        recordingName: req.recording?.recording_name ?? null,
        status: req.recording?.status ?? req.status,
        requestedAt: req.requested_at,
        timing: {
          elapsed_seconds: queuedAt ? Math.floor((now - queuedAt) / 1000) : null,
          r2_ready_seconds:
            queuedAt && r2ReadyAt ? Math.floor((r2ReadyAt - queuedAt) / 1000) : null,
          stream_ready_seconds:
            queuedAt && streamReadyAt ? Math.floor((streamReadyAt - queuedAt) / 1000) : null,
        },
        job: job
          ? {
              id: job.id,
              status: job.status,
              retry_count: job.retry_count,
              error_code: job.error_code,
              queued_at: job.queued_at,
              r2_ready_at: job.r2_ready_at,
              stream_ready_at: job.stream_ready_at,
            }
          : null,
      });
    }

    return results;
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
    r2_ready_seconds: number | null;
    stream_ready_seconds: number | null;
  };
  job: {
    id: string;
    status: ExtractionJobStatus;
    retry_count: number;
    error_code: string;
    queued_at: Date;
    r2_ready_at: Date;
    stream_ready_at: Date;
  } | null;
}
