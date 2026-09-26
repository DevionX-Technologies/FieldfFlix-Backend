import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import {
  ExtractionJob,
  ExtractionJobStatus,
} from './entities/extraction-job.entity';
import { Recording } from '../recording/entities/recording.entity';
import { ExtractionRequest } from '../recording/entities/extraction-request.entity';

/**
 * Statuses that mean a job already reached a durable outcome and must not be
 * rewound by a late-arriving callback or Pi response.
 */
const TERMINAL_STATUSES: ExtractionJobStatus[] = [
  ExtractionJobStatus.R2_READY,
  ExtractionJobStatus.STREAM_READY,
  ExtractionJobStatus.CANCELLED,
];

export interface R2VerifiedDetails {
  nvrDownloadCompletedAt?: Date | null;
  uploadStartedAt?: Date | null;
  uploadCompletedAt?: Date | null;
}

/**
 * Owns every `extraction_jobs` state transition that originates OUTSIDE the
 * dispatcher (Pi callback, Cloudflare Stream webhook, admin tooling).
 *
 * Lives in its own module so that both `ExtractionQueueModule` and
 * `CloudflareRecordingsModule` can depend on it without an import cycle —
 * `ExtractionQueueModule` already imports `CloudflareRecordingsModule`.
 */
@Injectable()
export class ExtractionJobProgressService {
  private readonly logger = new Logger(ExtractionJobProgressService.name);

  constructor(
    @InjectRepository(ExtractionJob)
    private readonly jobRepo: Repository<ExtractionJob>,
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectRepository(ExtractionRequest)
    private readonly extractionRequestRepo: Repository<ExtractionRequest>,
  ) {}

  /**
   * Marks the R2 object as verified. Reached only from the signed Pi callback,
   * which has already confirmed the object exists and is non-empty — so this is
   * allowed to recover a job that previously exhausted its retries.
   */
  async onR2Verified(
    recordingId: string,
    details?: R2VerifiedDetails,
  ): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { recordingId } });
    if (!job) {
      this.logger.debug(
        `No extraction job for recording=${recordingId}; skipping progress update`,
      );
      return;
    }

    if (job.status === ExtractionJobStatus.STREAM_READY) {
      // R2 verification is a prerequisite of Stream import; don't rewind it.
      return;
    }

    const now = new Date();
    await this.jobRepo.update(
      { id: job.id },
      {
        status: ExtractionJobStatus.R2_READY,
        nvr_download_completed_at:
          details?.nvrDownloadCompletedAt ??
          job.nvr_download_completed_at ??
          now,
        upload_started_at:
          details?.uploadStartedAt ?? job.upload_started_at ?? now,
        upload_completed_at:
          details?.uploadCompletedAt ?? job.upload_completed_at ?? now,
        r2_ready_at: job.r2_ready_at ?? now,
        error_code: null,
        error_message: null,
      },
    );

    await this.recordingRepo.update(recordingId, { status: 'r2_ready' });
    await this.extractionRequestRepo.update(
      { recordingId, status: 'pending' },
      { status: 'completed' },
    );
    this.logger.log(`Recording=${recordingId} R2 verified`);
  }

  async onStreamImportStarted(recordingId: string): Promise<void> {
    await this.jobRepo.update(
      { recordingId, status: ExtractionJobStatus.R2_READY },
      {
        status: ExtractionJobStatus.STREAM_IMPORTING,
        stream_import_started_at: new Date(),
      },
    );
  }

  /** Invoked from the Cloudflare Stream `video.ready` webhook. Idempotent. */
  async onStreamReady(recordingId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { recordingId } });
    if (!job) return;
    if (job.status === ExtractionJobStatus.STREAM_READY) return;

    await this.jobRepo.update(
      { id: job.id },
      {
        status: ExtractionJobStatus.STREAM_READY,
        stream_ready_at: job.stream_ready_at ?? new Date(),
      },
    );
    await this.recordingRepo.update(recordingId, { status: 'stream_ready' });
    this.logger.log(`Recording=${recordingId} is STREAM_READY`);
  }

  /**
   * Terminal failure reported by the Pi. Never rewinds a job that already
   * produced a playable asset.
   */
  async onTerminalFailure(
    recordingId: string,
    reason: string,
  ): Promise<{ applied: boolean; reason?: string }> {
    const job = await this.jobRepo.findOne({ where: { recordingId } });
    if (!job) return { applied: false, reason: 'no_job' };
    if (TERMINAL_STATUSES.includes(job.status)) {
      return { applied: false, reason: `already_${job.status}` };
    }

    await this.jobRepo.update(
      { id: job.id },
      {
        status: ExtractionJobStatus.FAILED,
        error_code: 'PI_FAILURE',
        error_message: reason,
        failed_at: new Date(),
        next_retry_at: null,
      },
    );
    await this.recordingRepo.update(recordingId, { status: 'failed' });
    await this.extractionRequestRepo.update(
      { recordingId, status: 'pending' },
      { status: 'failed' },
    );
    return { applied: true };
  }

  /** True when a job for this recording exists and is still in flight. */
  async hasQueuedOrActiveJob(recordingId: string): Promise<boolean> {
    const count = await this.jobRepo.count({
      where: {
        recordingId,
        status: In([ExtractionJobStatus.QUEUED, ...ACTIVE_STATUS_LIST]),
      },
    });
    return count > 0;
  }
}

const ACTIVE_STATUS_LIST: ExtractionJobStatus[] = [
  ExtractionJobStatus.DISPATCHING,
  ExtractionJobStatus.EXTRACTING,
  ExtractionJobStatus.UPLOADING_R2,
  ExtractionJobStatus.STREAM_IMPORTING,
];
