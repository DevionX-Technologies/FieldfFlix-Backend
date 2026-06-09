import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from 'src/user/entities/user.entity';

/**
 * The discrete activities that can earn a user points. Numeric values are
 * adjustable per-environment via the `point_configs` table — see
 * `PointConfig` and `PointsService.getPointValue`.
 */
export enum PointEventType {
  RECORDING_CREATE = 'recording_create',
  RECORDING_SHARE = 'recording_share',
  RECORDING_RECEIVE = 'recording_receive',
  PAYMENT_COMPLETE = 'payment_complete',
  FLICKSHORT_APPROVED = 'flickshort_approved',
}

/**
 * Audit log of every points award. One row per event so we can:
 *   - rebuild the leaderboard at any timestamp,
 *   - show the user a "your points" timeline,
 *   - guarantee idempotency via the unique `idempotency_key` index so a
 *     replayed webhook / double-submit never double-credits.
 *
 * `points` is denormalized from the config at the time of award so changing
 * a config later doesn't retroactively rewrite history.
 */
@Entity('point_events')
@Index('IDX_point_events_user_created', ['userId', 'createdAt'])
@Index('IDX_point_events_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_point_events_type_created', ['eventType', 'createdAt'])
export class PointEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: PointEventType })
  eventType: PointEventType;

  /** Recording id, share id, payment id, etc. — what this award is for. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  refId: string | null;

  /**
   * Stable key derived from (eventType + refId + userId). Unique-indexed so
   * repeated webhook deliveries collapse into one row instead of granting
   * the user points twice.
   */
  @Column({ type: 'varchar', length: 250 })
  idempotencyKey: string;

  /** Points granted at the moment of this event (snapshot of config value). */
  @Column({ type: 'integer' })
  points: number;

  /** Free-form context (e.g. recording title, flickshort id). JSONB for query flexibility. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
