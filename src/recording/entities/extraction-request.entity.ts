import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Recording } from './recording.entity';

@Entity('extraction_requests')
export class ExtractionRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Recording)
  @JoinColumn({ name: 'recordingId' })
  recording: Recording;

  @Column({ type: 'uuid' })
  recordingId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: string; // 'pending', 'processing', 'completed', 'failed'

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requested_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
