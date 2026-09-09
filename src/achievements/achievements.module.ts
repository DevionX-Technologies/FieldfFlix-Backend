import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserPoints } from 'src/points/entities/user-points.entity';
import { User } from 'src/user/entities/user.entity';
import { NotificationEntity } from 'src/notification/entities/notification.entity';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { AchievementEvaluationService } from './services/achievement-evaluation.service';
import { AchievementRewardService } from './services/achievement-reward.service';
import { AchievementAggregatorService } from './services/achievement-aggregator.service';
import { AchievementMetricsBufferService } from './services/achievement-metrics-buffer.service';
import { AchievementEventConsumer } from './events/achievement-event.consumer';
import { PointsModule } from 'src/points/points.module';
import { UserModule } from 'src/user/user.module';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TypeOrmModule.forFeature([
      AchievementDefinition,
      UserAchievementMetrics,
      UserAchievement,
      UserPoints,
      User,
      NotificationEntity,
    ]),
    PointsModule,
    forwardRef(() => UserModule),
    CommonModule,
  ],
  controllers: [AchievementsController],
  providers: [
    AchievementsService,
    AchievementEvaluationService,
    AchievementRewardService,
    AchievementAggregatorService,
    AchievementMetricsBufferService,
    AchievementEventConsumer,
  ],
  exports: [
    AchievementsService,
    AchievementEvaluationService,
    AchievementRewardService,
    AchievementAggregatorService,
    AchievementMetricsBufferService,
    TypeOrmModule,
  ],
})
export class AchievementsModule {}
