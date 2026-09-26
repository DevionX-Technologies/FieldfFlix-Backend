import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Recording } from '../../recording/entities/recording.entity';

export enum ExtractionJobStatus {
  QUEUED = 'QUEUED',
  DISPATCHING = 'DISPATCHING',
  EXTRACTING = 'EXTRACTING',
  UPLOADING_R2 = 'UPLOADING_R2',
  R2_READY = 'R2_READY',
  STREAM_IMPORTING = 'STREAM_IMPORTING',
  STREAM_READY = 'STREAM_READY',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('extraction_jobs')
export class ExtractionJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Recording)
  @JoinColumn({ name: 'recordingId' })
  recording: Recording;

  @Column({ type: 'uuid' })
  recordingId: string;

  @Column({ type: 'varchar', default: ExtractionJobStatus.QUEUED })
  status: ExtractionJobStatus;

  @Column({ type: 'int', default: 0 })
  retry_count: number;

  @Column({ type: 'int', default: 3 })
  max_retries: number;

  @Column({ type: 'varchar', nullable: true })
  worker_id: string; // which Pi is handling this

  /**
   * Denormalised Pi gateway base URL, captured at enqueue time. Lets the
   * dispatcher apply per-Pi concurrency limits with a single indexed query
   * instead of joining through `recordings.metadata`.
   */
  @Column({ type: 'varchar', nullable: true })
  pi_base_url: string;

  @Column({ type: 'varchar', nullable: true })
  error_code: string;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  /** Time the job was first enqueued. Never reset by retries (telemetry). */
  @Column({ type: 'timestamp', nullable: true })
  first_queued_at: Date;

  /** Time the job most recently (re)entered the QUEUED state (backoff window). */
  @Column({ type: 'timestamp', nullable: true })
  queued_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  dispatched_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  nvr_download_started_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  nvr_download_completed_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  upload_started_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  upload_completed_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  r2_ready_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  stream_import_started_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  stream_ready_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  failed_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  next_retry_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
