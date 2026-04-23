import { TurfEntity } from 'src/turfs/entities/turfs.entity';
import { User } from 'src/user/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { EMediaUploadType } from '../enum/media-upload.enum';
import { Transform } from 'class-transformer';

@Entity('media_uploads')
export class MediaUploadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TurfEntity, (turf) => turf.mediaUploads, { nullable: true })
  @JoinColumn({ name: 'turf_id' })
  turf: TurfEntity;

  @Transform(({ value }) =>
    value !== null && value !== undefined ? value.toString() : null,
  )
  @Column({ type: 'bigint', nullable: true })
  file_size: bigint;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  turf_id: string;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 255 })
  bucket_name: string;

  @ManyToOne(() => User, (user) => user.mediaUploads, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: true })
  user_id: string;

  @Column({ type: 'varchar', length: 255 })
  media_url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_asset_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mux_playback_id: string;

  @Column({
    type: 'varchar',
    length: 50,
    default: EMediaUploadType.VIDEO,
  })
  media_upload_type: EMediaUploadType;

  @Column({ type: 'varchar', length: 50 })
  content_type: string;

  @Column({ type: 'boolean', default: false })
  is_favorite: boolean;

  @Column({ type: 'uuid', nullable: true, unique: true })
  @Index()
  share_token: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
