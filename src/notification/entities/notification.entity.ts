import { MessageStatus } from 'src/constant/enum';
import { User } from 'src/user/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notification')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, (user) => user.user_devices_token)
  @JoinColumn({ name: 'user_id' })
  user: string;

  @Column({ type: 'varchar', nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string;

  @Column({ type: 'jsonb', nullable: false })
  data: any[];

  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.UNREAD,
    enumName: `notification_lead_type`,
  })
  message_status: MessageStatus;

  @Column({ type: 'varchar', nullable: true })
  notification_type: string;

  @Column({ type: Boolean, default: false })
  is_soft_delete: boolean;

  @CreateDateColumn({ type: 'timestamp', default: null })
  read_at: Date;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
