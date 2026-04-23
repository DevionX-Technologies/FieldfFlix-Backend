import { MediaUploadEntity } from 'src/media-upload/entities/media-upload.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { TurfImageEntity } from './turf-images.entity';
import { ESportsSupported, ESurfaceType } from '../enum/turfs.enum';
import { TurfAmenitiesEntity } from './turf-amenities.entity';
import { Recording } from 'src/recording/entities/recording.entity';

@Entity('turfs')
export class TurfEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  size_length: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  size_width: number;

  @Column({
    type: 'enum',
    enum: [ESurfaceType.ARTIFICIAL_GRASS],
    default: [ESurfaceType.ARTIFICIAL_GRASS],
    enumName: 'ESurfaceType',
    array: true,
  })
  surface_type: ESurfaceType[];

  @Column({
    type: 'enum',
    enum: ESportsSupported,
    default: [ESportsSupported.FOOTBALL],
    enumName: 'ESportsSupported',
    array: true,
  })
  sports_supported: ESportsSupported[];

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  geo_location: object;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  address_line: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  postal_code: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  hourly_rate: number;

  @Column({ type: 'time', nullable: true })
  opening_time: string;

  @Column({ type: 'time', nullable: true })
  closing_time: string;

  @Column({ nullable: true })
  max_capacity: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ length: 20, nullable: true })
  contact_phone: string;

  @Column({ length: 100, nullable: true })
  contact_email: string;

  @Column({ type: 'text', nullable: true })
  cancellation_policy: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @OneToMany(() => MediaUploadEntity, (mediaUpload) => mediaUpload.turf)
  mediaUploads: MediaUploadEntity[];

  @OneToMany(() => TurfImageEntity, (turfImage) => turfImage.turf)
  turfImages: TurfImageEntity[];

  @OneToOne(() => TurfAmenitiesEntity, (turfImage) => turfImage.turf)
  amenities: TurfAmenitiesEntity;

  @OneToMany(() => Recording, (rc) => rc.turf)
  recording: Recording[];
}
