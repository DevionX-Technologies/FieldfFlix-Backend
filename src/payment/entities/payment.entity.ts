import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import { Recording } from 'src/recording/entities/recording.entity';

/**
 * Payment status enumeration
 */
export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

/**
 * Payment type enumeration
 */
export enum PaymentType {
  RECORDING_ACCESS = 'recording_access',
  HIGHLIGHT_ACCESS = 'highlight_access',
  MEDIA_ACCESS = 'media_access',
}

/**
 * Payment entity to track all payment transactions
 */
@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.payments)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid' })
  @Index()
  user_id: string;

  @ManyToOne(() => Recording, { nullable: true })
  @JoinColumn({ name: 'recording_id' })
  recording: Recording;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  recording_id: string;

  @Column({ type: 'varchar', length: 100 })
  @Index()
  razorpay_order_id: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  razorpay_payment_id: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  razorpay_signature: string;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  base_amount: number;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({
    type: 'enum',
    enum: PaymentType,
  })
  payment_type: PaymentType;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
