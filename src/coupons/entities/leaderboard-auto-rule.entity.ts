import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Hybrid "auto-assign on period close, admin can override" rules.
 *
 * Each row says:
 *   "When the {period} leaderboard closes, take the user at rank {rank} and
 *    grant them an assignment of coupon {couponId}."
 *
 * Admin can:
 *   - Pre-stage rules (defaults on every period close).
 *   - Disable a rule temporarily.
 *   - Manually re-assign the winner to a different coupon before users are
 *     notified (the auto-grant fires at period close but the admin has a
 *     short window to swap before pushes go out).
 *
 * The actual close job + notification work isn't included yet — this entity
 * just lets the admin codify intent so it's ready when the cron lands.
 */
@Entity('leaderboard_auto_rules')
@Index('IDX_lb_auto_rules_period_rank', ['period', 'rank'], { unique: true })
export class LeaderboardAutoRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  period: 'weekly' | 'monthly';

  /** 1-based rank this rule targets. */
  @Column({ type: 'integer' })
  rank: number;

  @Column({ type: 'uuid' })
  couponId: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
