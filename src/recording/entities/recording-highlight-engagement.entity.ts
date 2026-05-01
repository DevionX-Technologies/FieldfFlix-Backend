import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import { RecordingHighlights } from './recording-highlights.entity';

@Entity('recording_highlight_engagements')
@Unique('UQ_highlight_engagement_user_highlight', ['userId', 'recordingHighlightId'])
export class RecordingHighlightEngagement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'recording_highlight_id', type: 'uuid' })
  recordingHighlightId: string;

  @ManyToOne(() => RecordingHighlights, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recording_highlight_id' })
  highlight: RecordingHighlights;

  @Column({ type: 'boolean', default: false })
  liked: boolean;

  @Column({ type: 'boolean', default: false })
  saved: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
