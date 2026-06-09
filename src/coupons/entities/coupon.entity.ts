import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A coupon template. Admin creates one; many `CouponAssignment` rows fan out
 * one per user. Each assignment can be redeemed at most `maxRecordings`
 * times before the assignment is exhausted.
 */
@Entity('coupons')
@Index('IDX_coupons_code', ['code'], { unique: true })
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Short human-readable code shown to users and entered at checkout. Stored
   * uppercase. Unique across the whole table.
   */
  @Column({ type: 'varchar', length: 30 })
  code: string;

  /** Friendly display label used in admin UI and user notifications. */
  @Column({ type: 'varchar', length: 200 })
  label: string;

  /** Discount percent, 1–100. We don't support absolute-rupee discounts here. */
  @Column({ type: 'integer' })
  discountPercent: number;

  /**
   * How many recording-unlock purchases a single assignment can be redeemed
   * against. Min 1.
   */
  @Column({ type: 'integer', default: 1 })
  maxRecordings: number;

  /** Earliest moment the coupon can be redeemed. Inclusive. */
  @Column({ type: 'timestamp', nullable: true })
  startsAt: Date | null;

  /** Last moment the coupon can be redeemed. Exclusive. */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  /** Admin can disable a coupon without deleting it. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** User who created this row (audit only). */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
