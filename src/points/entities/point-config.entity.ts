import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PointEventType } from './point-event.entity';

/**
 * Admin-editable point values per event type. Singleton row per event.
 * Defaults are inserted by `PointsService.ensureDefaults` on first boot:
 *
 *   recording_create      → 5
 *   recording_share       → 2
 *   recording_receive     → 1
 *   payment_complete      → 1
 *   flickshort_approved   → 2
 *
 * Admin can override via `PATCH /points/configs/:eventType`.
 */
@Entity('point_configs')
export class PointConfig {
  @PrimaryColumn({ type: 'enum', enum: PointEventType })
  eventType: PointEventType;

  @Column({ type: 'integer' })
  points: number;

  /** Human-friendly label shown in admin UI. Stored so admins can rename without code change. */
  @Column({ type: 'varchar', length: 100 })
  label: string;

  /** Toggle to disable awarding without deleting the row. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
