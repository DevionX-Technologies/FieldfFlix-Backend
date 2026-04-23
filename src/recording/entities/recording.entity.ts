import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../user/entities/user.entity'; // Assuming User entity path
import { Camera } from '../../camera/camera.entity'; // Assuming Camera entity path
import { SharedRecording } from './shared-recording.entity';
import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { RecordingHighlights } from './recording-highlights.entity';
import { PaymentEntity } from 'src/payment/entities/payment.entity';

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
   * The user who initiated the recording.
   */
  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  /**
   * ID of the user who initiated the recording.
   */
  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @ManyToOne(() => TurfEntity, (turf) => turf.recording)
  @JoinColumn({ name: 'turfId' })
  turf: TurfEntity;

  @Column({ type: 'uuid', nullable: true })
  turfId: string;

  /**
   * The camera used for the recording.
   */
  @ManyToOne(() => Camera)
  @JoinColumn({ name: 'cameraId' })
  camera: Camera;

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

  @OneToMany(() => SharedRecording, (shared) => shared.recording)
  sharedRecordings: SharedRecording[];

  @OneToMany(() => RecordingHighlights, (rt) => rt.recording)
  recordingHighlights: RecordingHighlights[];

  @OneToMany(() => PaymentEntity, (payment) => payment.recording)
  payments: PaymentEntity[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_watermark_media_path: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_watermark_media_bucket: string;


  @Column({ type: 'varchar', length: 255, nullable: true })
  recording_name: string | null;

  @Column({ type: 'boolean', default: false })
  isVideoCreated: boolean;
}
