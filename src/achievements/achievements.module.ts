import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { User } from 'src/user/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AchievementDefinition,
      UserAchievementMetrics,
      UserAchievement,
      User,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class AchievementsModule {}
