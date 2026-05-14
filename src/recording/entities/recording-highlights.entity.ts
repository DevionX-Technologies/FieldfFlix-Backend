import { Recording } from 'src/recording/entities/recording.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('recording_highlights')
export class RecordingHighlights {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Recording, (recording) => recording.recordingHighlights, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'recording_id' })
  recording: Recording;

  @Column({ type: 'uuid', nullable: false, name: 'recording_id' })
  recordingId: string;

  @Column({ type: 'timestamp', nullable: false })
  button_click_timestamp: Date;

  @Column({ type: 'varchar', nullable: true })
  relative_timestamp?: string;

  @Column({ type: 'varchar', nullable: true })
  source_asset_id?: string;

  @Column({ type: 'varchar', nullable: true })
  asset_id?: string;

  @Column({ type: 'varchar', nullable: true })
  status?: string;

  @Column({ type: 'varchar', length: 10000, nullable: true })
  failed_message?: string;

  @Column({ type: 'text', nullable: true })
  playback_id?: string;

  @Column({ type: 'text', nullable: true })
  mux_public_playback_url?: string;

  @Column({ type: 'varchar', nullable: true })
  bucketName?: string;

  @Column({ type: 'text', nullable: true })
  s3path?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    errorRetryCount?: number;
    /** Mux static MP4 export tracking (backfill / ops). */
    muxStaticMp4?: {
      status?: string;
      name?: string;
      muxAssetId?: string;
      playbackId?: string;
      updatedAt?: string;
      note?: string;
    };
    rateLimitRetryCount?: number;
    retryHistory?: Array<{
      attempt: number;
      timestamp: string;
      errorType?: string;
      httpStatus?: number;
      errorMessage?: string;
      delayApplied?: number;
      previousStatus?: string;
      previousErrorMessage?: string;
    }>;
    permanentlyFailed?: boolean;
    permanentlyFailedAt?: string;
    permanentlyFailedReason?: string;
    finalError?: any;
    lastRetryAttempt?: string;
  };

  @Column({ type: 'boolean', default: false })
  isClipCreated: boolean;

  @Column({ type: 'integer', default: 0 })
  retryCount: number;

  @Column({ type: 'integer', nullable: true })
  processing_order?: number;

  @Column({ type: 'integer', default: 0 })
  rate_limit_retry_count: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sqs_message_id?: string;

  @Column({ type: 'integer', default: 0 })
  lock_version: number;

  @Column({ name: 'likes_count', type: 'int', default: 0 })
  likesCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
