import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import { AchievementStatus } from '../../interface/achievement.interface';
import { AchievementDefinition } from './achievement-definition.entity';

/**
 * Tracks milestone progress and claim state for an individual user and achievement.
 */
@Entity('user_achievements')
@Unique('UQ_user_achievement_user_definition', ['userId', 'achievementId'])
@Index('IDX_user_achievements_user_status', ['userId', 'status'])
@Index('IDX_user_achievements_user_claim', [
  'userId',
  'isCompleted',
  'isRewardClaimed',
])
export class UserAchievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  achievementId: string;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number | string) => value,
      from: (value: string | number) =>
        value !== null && value !== undefined ? Number(value) : value,
    },
  })
  currentProgress: number;

  @Column({
    type: 'bigint',
    transformer: {
      to: (value: number | string) => value,
      from: (value: string | number) =>
        value !== null && value !== undefined ? Number(value) : value,
    },
  })
  targetValue: number;

  @Column({
    type: 'enum',
    enum: AchievementStatus,
    enumName: 'achievement_status_enum',
    default: AchievementStatus.LOCKED,
  })
  status: AchievementStatus;

  @Column({ type: 'boolean', default: false })
  isCompleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  isRewardClaimed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => AchievementDefinition, (def) => def.userAchievements, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'achievementId' })
  achievementDefinition: AchievementDefinition;
}
