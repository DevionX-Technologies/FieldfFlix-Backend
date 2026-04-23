import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TurfEntity } from './turfs.entity';

@Entity('turf_images')
export class TurfImageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TurfEntity, (turf) => turf.turfImages, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'turf_id' })
  turf: TurfEntity;

  @Column({ type: 'uuid' })
  turf_id: string;

  @Column({ type: 'varchar', nullable: true })
  file_name: string;

  @Column({ type: 'varchar', length: 50 })
  content_type: string;

  @Column({ type: 'bigint', nullable: true })
  file_size: bigint;

  @Column({ type: 'varchar', length: 255 })
  image_url: string;

  @Column({ type: 'varchar', length: 255 })
  bucket_name: string;

  @Column({ type: 'boolean', default: false })
  is_turf_profile: boolean;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
