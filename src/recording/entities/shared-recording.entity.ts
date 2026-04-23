import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Recording } from './recording.entity';
import { User } from '../../user/entities/user.entity';

@Entity('shared_recordings')
export class SharedRecording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  recording_id: string;

  @Column({ type: 'uuid' })
  shared_with_user_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Recording, (recording) => recording.sharedRecordings)
  @JoinColumn({ name: 'recording_id' })
  recording: Recording;

  @ManyToOne(() => User, (user) => user.receivedSharedRecordings)
  @JoinColumn({ name: 'shared_with_user_id' })
  sharedWithUser: User;
}
