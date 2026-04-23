import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { TurfEntity } from './turfs.entity';

@Entity('turf_amenities')
export class TurfAmenitiesEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  turf_id: string;

  @OneToOne(() => TurfEntity, (turf) => turf.amenities, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'turf_id' })
  turf: TurfEntity;

  @Column({ type: 'jsonb', nullable: true })
  amenities_details: Array<{
    key: string;
    label: string;
    active: boolean;
    iconKey: string;
  }>;

  @Column({ default: false })
  has_parking: boolean;

  @Column({ default: false })
  has_changing_room: boolean;

  @Column({ default: false })
  has_washroom: boolean;

  @Column({ default: false })
  has_drinking_water: boolean;

  @Column({ default: false })
  has_first_aid: boolean;

  @Column({ default: false })
  has_floodlights: boolean;

  @Column({ default: false })
  has_equipment_rental: boolean;

  @Column({ default: false })
  has_refreshments: boolean;

  @Column({ default: false })
  has_wifi: boolean;

  @Column({ default: false })
  has_seating_area: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
