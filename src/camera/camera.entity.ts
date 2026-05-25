import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Recording } from 'src/recording/entities/recording.entity';
import { TurfEntity } from '../turfs/entities/turfs.entity';

@Entity('cameras')
export class Camera {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;

  // Relationship to Turf
  @Column({ type: 'uuid', nullable: true })
  turfId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  raspberryPiBaseUrl: string;

  /** Venue physical court / ground index (shown in-app; optional legacy rows may be unset). */
  @Column({ type: 'integer', nullable: true })
  court_number: number | null;

  @ManyToOne(() => TurfEntity)
  @JoinColumn({ name: 'turfId' })
  turf: TurfEntity;

  @OneToMany(() => Recording, (recording) => recording.camera)
  recording: Recording[];
}
