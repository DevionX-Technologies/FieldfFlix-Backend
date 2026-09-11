import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AchievementDefinition } from '../entities/achievement-definition.entity';
import { UserAchievement } from '../entities/user-achievement.entity';
import { UserAchievementMetrics } from '../entities/user-achievement-metrics.entity';
import { PointsService } from 'src/points/points.service';
import { PointEventType } from 'src/points/entities/point-event.entity';
import { AchievementStatus } from 'src/interface/achievement.interface';
import { ClaimAchievementResponseDto } from '../dto/achievement-response.dto';
import { AchievementEvaluationService } from './achievement-evaluation.service';

@Injectable()
export class AchievementRewardService {
  private readonly logger = new Logger(AchievementRewardService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly pointsService: PointsService,
    private readonly evaluationService: AchievementEvaluationService,
  ) {}

  /**
   * Task 7 & 8: Safe achievement reward claim endpoint with server-side completion validation,
   * transactional row locking, idempotency, points award, and standardized error handling.
   */
  async claimAchievementReward(
    userId: string,
    achievementId: string,
  ): Promise<ClaimAchievementResponseDto> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }

    if (
      !achievementId ||
      typeof achievementId !== 'string' ||
      !achievementId.trim()
    ) {
      throw new BadRequestException('Achievement ID is required');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. Verify achievement definition exists and is active
      const definition = await manager
        .getRepository(AchievementDefinition)
        .findOne({ where: { id: achievementId } });

      if (!definition) {
        throw new NotFoundException(
          `Achievement '${achievementId}' does not exist in the catalog`,
        );
      }

      if (!definition.isActive) {
        throw new BadRequestException(
          `Achievement '${definition.title}' is currently not active`,
        );
      }

      // 2. Fetch or initialize user achievement record with row-level locking (SELECT FOR UPDATE)
      let ua = await manager
        .getRepository(UserAchievement)
        .createQueryBuilder('ua')
        .setLock('pessimistic_write')
        .where('ua.userId = :userId AND ua.achievementId = :achievementId', {
          userId,
          achievementId,
        })
        .getOne();

      // Invariant 5.3: Idempotent claim check (reject double-claims with 409 Conflict)
      if (
        ua &&
        (ua.isRewardClaimed || ua.status === AchievementStatus.CLAIMED)
      ) {
        throw new ConflictException(
          `Achievement reward for '${definition.title}' has already been claimed`,
        );
      }

      // 3. Server-side completion validation: verify telemetry threshold
      const targetVal = Number(definition.targetValue);
      const metrics = await manager
        .getRepository(UserAchievementMetrics)
        .findOne({ where: { userId } });

      const prevTotals = await this.pointsService.getMyTotals(userId);
      const telemetryValue = this.evaluationService.getTelemetryMetricValue(
        metrics,
        definition.metricKey,
        prevTotals.level,
      );

      const effectiveProgress = Math.max(
        ua ? Number(ua.currentProgress) : 0,
        telemetryValue,
      );

      const isEligible =
        (ua && ua.isCompleted) || effectiveProgress >= targetVal;

      if (!isEligible) {
        throw new BadRequestException(
          `Achievement '${definition.title}' requirements have not been completed (${effectiveProgress}/${targetVal})`,
        );
      }

      // 4. Update user achievement state atomically
      const now = new Date();
      if (!ua) {
        ua = manager.getRepository(UserAchievement).create({
          userId,
          achievementId,
          currentProgress: Math.max(effectiveProgress, targetVal),
          targetValue: targetVal,
          status: AchievementStatus.CLAIMED,
          isCompleted: true,
          completedAt: now,
          isRewardClaimed: true,
          claimedAt: now,
        });
      } else {
        ua.currentProgress = Math.max(effectiveProgress, targetVal);
        ua.isCompleted = true;
        if (!ua.completedAt) {
          ua.completedAt = now;
        }
        ua.isRewardClaimed = true;
        ua.claimedAt = now;
        ua.status = AchievementStatus.CLAIMED;
      }

      await manager.getRepository(UserAchievement).save(ua);

      // 5. Award XP through PointsService
      const previousLevel = prevTotals.level;

      await this.pointsService.awardPoints({
        userId,
        eventType: PointEventType.ACHIEVEMENT_CLAIM,
        refId: achievementId,
        points: definition.xpReward,
        metadata: {
          achievementId: definition.id,
          title: definition.title,
          category: definition.category,
          tier: definition.tier,
        },
      });

      // 6. Calculate updated levels
      const newTotals = await this.pointsService.getMyTotals(userId);
      const currentLevel = newTotals.level;
      const currentLevelName = newTotals.levelName || 'Bronze';
      const levelUpOccurred = currentLevel > previousLevel;

      this.logger.log(
        `User ${userId} claimed achievement '${definition.id}' (+${definition.xpReward} XP). Level: ${previousLevel} -> ${currentLevel}`,
      );

      return {
        achievementId: definition.id,
        title: definition.title,
        xpAwarded: definition.xpReward,
        newTotalXp: newTotals.totalPoints,
        previousLevel,
        currentLevel,
        currentLevelName,
        levelUpOccurred,
        claimedAt: ua.claimedAt.toISOString(),
      };
    });
  }
}
