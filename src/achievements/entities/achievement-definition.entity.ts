import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  AchievementCategory,
  AchievementTier,
} from '../../interface/achievement.interface';
import { UserAchievement } from './user-achievement.entity';

@Entity('achievement_definitions')
@Index('IDX_achievements_metric', ['metricKey', 'targetValue'])
@Index('IDX_achievements_category_order', ['category', 'displayOrder'])
export class AchievementDefinition {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({
    type: 'enum',
    enum: AchievementCategory,
    enumName: 'achievement_category_enum',
  })
  category: AchievementCategory;

  @Column({
    type: 'enum',
    enum: AchievementTier,
    enumName: 'achievement_tier_enum',
  })
  tier: AchievementTier;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 128 })
  requirementText: string;

  @Column({ type: 'varchar', length: 64 })
  metricKey: string;

  @Column({
    type: 'bigint',
    transformer: {
      to: (value: number | string) => value,
      from: (value: string | number) =>
        value !== null && value !== undefined ? Number(value) : value,
    },
  })
  targetValue: number;

  @Column({ type: 'integer', default: 100 })
  xpReward: number;

  @Column({ type: 'varchar', length: 128 })
  badgeAssetKey: string;

  @Column({ type: 'integer', default: 0 })
  displayOrder: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => UserAchievement, (ua) => ua.achievementDefinition)
  userAchievements: UserAchievement[];
}
