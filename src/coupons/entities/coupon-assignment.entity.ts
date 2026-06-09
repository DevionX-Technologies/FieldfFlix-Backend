import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Coupon } from './coupon.entity';
import { User } from 'src/user/entities/user.entity';

/**
 * One row per (coupon, user) assignment.
 *
 * - `manual` assignments come from an admin clicking "Grant coupon" on the
 *   admin leaderboard or user detail screen.
 * - `auto_leaderboard` assignments are created by the period-end leaderboard
 *   job (see `LeaderboardAutoRule`) for the top-N users in a window.
 *
 * `remainingRecordings` decrements on each successful redemption. When it
 * hits 0 the assignment is exhausted; redeeming again falls back to a
 * different active assignment (or no discount).
 */
export type CouponAssignmentSource = 'manual' | 'auto_leaderboard';

@Entity('coupon_assignments')
@Index('IDX_coupon_assignments_user', ['userId'])
@Index('IDX_coupon_assignments_coupon_user', ['couponId', 'userId'], {
  unique: true,
})
export class CouponAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  couponId: string;

  @ManyToOne(() => Coupon, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'couponId' })
  coupon: Coupon;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 30, default: 'manual' })
  source: CouponAssignmentSource;

  /** Redemptions left on this assignment. Decremented atomically on redeem. */
  @Column({ type: 'integer' })
  remainingRecordings: number;

  /** Free-form admin note / leaderboard period label etc. */
  @Column({ type: 'varchar', length: 250, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
