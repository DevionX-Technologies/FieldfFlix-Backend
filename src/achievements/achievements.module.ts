import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserPoints } from 'src/points/entities/user-points.entity';
import { User } from 'src/user/entities/user.entity';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { PointsModule } from 'src/points/points.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AchievementDefinition,
      UserAchievementMetrics,
      UserAchievement,
      UserPoints,
      User,
    ]),
    PointsModule,
    forwardRef(() => UserModule),
  ],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService, TypeOrmModule],
})
export class AchievementsModule {}

