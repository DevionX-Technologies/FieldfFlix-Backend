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
import { CouponAssignment } from './coupon-assignment.entity';
import { User } from 'src/user/entities/user.entity';

/**
 * Audit log of every successful coupon redemption. Append-only.
 *
 * Useful for:
 *   - Admin "what discount was applied here?" queries
 *   - Refund flows that need to know which payment used which assignment
 *   - Periodic reports on coupon ROI
 *
 * Idempotency keyed by `paymentId` so a webhook retry never double-counts.
 */
@Entity('coupon_redemptions')
@Index('IDX_coupon_redemptions_payment', ['paymentId'], { unique: true })
@Index('IDX_coupon_redemptions_user', ['userId'])
@Index('IDX_coupon_redemptions_coupon', ['couponId'])
export class CouponRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  couponId: string;

  @ManyToOne(() => Coupon, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'couponId' })
  coupon: Coupon;

  @Column({ type: 'uuid' })
  assignmentId: string;

  @ManyToOne(() => CouponAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignmentId' })
  assignment: CouponAssignment;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  /** Payment row the discount was applied to. */
  @Column({ type: 'uuid', nullable: true })
  paymentId: string | null;

  /** Recording id the payment unlocked. */
  @Column({ type: 'uuid', nullable: true })
  recordingId: string | null;

  /** Snapshot of the rupee math at redemption time. */
  @Column({ type: 'integer' })
  basePriceInr: number;

  @Column({ type: 'integer' })
  discountedPriceInr: number;

  @Column({ type: 'integer' })
  discountPercentApplied: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
