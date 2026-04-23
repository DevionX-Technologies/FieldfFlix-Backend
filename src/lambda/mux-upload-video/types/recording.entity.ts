import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Represents a recording session.
 */
@Entity('recordings')
export class Recording {
  /**
   * Unique identifier for the recording.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * ID of the user who initiated the recording.
   */
  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  turfId: string;

  /**
   * ID of the camera used for the recording.
   */
  @Column({ type: 'uuid', nullable: true })
  cameraId: string;

  /**
   * Timestamp when the recording started.
   */
  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  startTime: Date;

  /**
   * Timestamp when the recording ended.
   */
  @Column({ type: 'timestamp', nullable: true })
  endTime: Date;

  // @Column({ type: 'integer', nullable: true })
  // duration: number;

  /**
   * S3 path where the recorded video file is stored.
   */
  @Column({ nullable: true })
  s3Path: string;

  /**
   * ID of the recording on the Raspberry Pi device.
   */
  @Column({ nullable: true })
  raspberryPiRecordingId: string;

  /**
   * Current status of the recording (e.g., 'in_progress', 'completed', 'failed').
   */
  @Column({ default: 'in_progress' }) // e.g., 'in_progress', 'completed', 'failed'
  status: string;

  /**
   * Timestamp of the last update to the recording entity.
   */
  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  /**
   * Optional metadata associated with the recording.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: any; // Consider defining a more specific type if possible

  /**
   * Indicates if the recording is marked as favorite.
   */
  @Column({ type: 'boolean', default: false })
  is_favorite: boolean;

  /**
   * Token for sharing the recording.
   */
  @Column({ type: 'uuid', nullable: true, unique: true })
  share_token: string;

  /**
   * The ID of the asset in Mux.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_asset_id: string;

  /**
   * The ID of the playback ID in Mux.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_playback_id: string;

  /**
   * The Mux media URL for streaming the video.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_media_url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_watermark_media_path: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_watermark_media_bucket: string;

  /**
   * Indicates if the main video asset has been created in Mux.
   * This flag prevents duplicate video creation.
   */
  @Column({ type: 'boolean', default: false })
  isVideoCreated: boolean;
}
