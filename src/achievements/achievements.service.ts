import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { PointsService } from '../points/points.service';
import { APPROVED_ACHIEVEMENT_DEFINITIONS } from '../constant/achievement-catalog.constant';
import { AchievementStatus } from '../interface/achievement.interface';
import { AchievementQueryDto } from './dto/achievement-query.dto';
import {
  AchievementSummaryDto,
  ClaimAchievementResponseDto,
  GetAchievementsResponseDto,
  UserAchievementItemDto,
} from './dto/achievement-response.dto';
import { AchievementEvaluationService } from './services/achievement-evaluation.service';
import { AchievementRewardService } from './services/achievement-reward.service';
import { AchievementAggregatorService } from './services/achievement-aggregator.service';
import { AchievementMetricsBufferService } from './services/achievement-metrics-buffer.service';

@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    @InjectRepository(AchievementDefinition)
    private readonly definitionRepo: Repository<AchievementDefinition>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(UserAchievementMetrics)
    private readonly metricsRepo: Repository<UserAchievementMetrics>,
    private readonly pointsService: PointsService,
    public readonly evaluationService: AchievementEvaluationService,
    public readonly rewardService: AchievementRewardService,
    public readonly aggregatorService: AchievementAggregatorService,
    public readonly bufferService: AchievementMetricsBufferService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCatalogSeeded();
  }

  /**
   * Seed / sync the master catalog from authoritative APPROVED_ACHIEVEMENT_DEFINITIONS.
   * Safe to run on every application boot.
   */
  async ensureCatalogSeeded(): Promise<void> {
    try {
      const existing = await this.definitionRepo.find({ select: ['id'] });
      const existingIds = new Set(existing.map((d) => d.id));

      const toInsert = APPROVED_ACHIEVEMENT_DEFINITIONS.filter(
        (def) => !existingIds.has(def.id),
      );

      if (toInsert.length > 0) {
        const entities = toInsert.map((def) =>
          this.definitionRepo.create({
            id: def.id,
            category: def.category,
            tier: def.tier,
            title: def.title,
            description: def.description,
            requirementText: def.requirementText,
            metricKey: def.metricKey,
            targetValue: def.targetValue,
            xpReward: def.xpReward,
            badgeAssetKey: def.badgeAssetKey,
            displayOrder: def.displayOrder,
            isActive: def.isActive ?? true,
          }),
        );
        await this.definitionRepo.save(entities);
        this.logger.log(
          `Seeded ${entities.length} achievement definitions into catalog.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to seed achievement definitions: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Delegate to evaluation service for resolving metric telemetry
   */
  public getTelemetryMetricValue(
    metrics: UserAchievementMetrics | null,
    metricKey: string,
    userLevel = 1,
  ): number {
    return this.evaluationService.getTelemetryMetricValue(metrics, metricKey, userLevel);
  }

  /**
   * Delegate to evaluation service for progress formatting
   */
  public formatProgressText(
    current: number,
    target: number,
    metricKey: string,
  ): string {
    return this.evaluationService.formatProgressText(current, target, metricKey);
  }

  /**
   * Main GET Achievements endpoint with normalized response DTO and summary statistics.
   */
  async getAchievements(
    userId: string,
    filter?: AchievementQueryDto,
  ): Promise<GetAchievementsResponseDto> {
    // 1. Fetch all active definitions ordered by display order
    const definitions = await this.definitionRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });

    // 2. Fetch user's achievements, telemetry metrics, and user points totals
    const [userAchievements, metrics, userPointsTotals] = await Promise.all([
      this.userAchievementRepo.find({ where: { userId } }),
      this.metricsRepo.findOne({ where: { userId } }),
      this.pointsService.getMyTotals(userId),
    ]);

    const userAchievementMap = new Map<string, UserAchievement>();
    for (const ua of userAchievements) {
      userAchievementMap.set(ua.achievementId, ua);
    }

    let unlockedCount = 0;
    let inProgressCount = 0;
    let lockedCount = 0;
    let unclaimedRewardsCount = 0;
    let totalClaimedXp = 0;

    const items: UserAchievementItemDto[] = [];

    for (const def of definitions) {
      const ua = userAchievementMap.get(def.id);
      const targetVal = Number(def.targetValue);

      // Determine progress respecting the non-regression invariant
      const telemetryValue = this.getTelemetryMetricValue(
        metrics,
        def.metricKey,
        userPointsTotals.level,
      );

      let currentProgress = ua ? Number(ua.currentProgress) : 0;
      let isCompleted = ua ? Boolean(ua.isCompleted) : false;
      let isRewardClaimed = ua ? Boolean(ua.isRewardClaimed) : false;
      let status = ua ? ua.status : AchievementStatus.LOCKED;
      let completedAt = ua?.completedAt ? ua.completedAt.toISOString() : null;
      let claimedAt = ua?.claimedAt ? ua.claimedAt.toISOString() : null;

      // Monotonic progression safeguard
      if (!isCompleted) {
        currentProgress = Math.max(currentProgress, telemetryValue);
        if (currentProgress >= targetVal) {
          isCompleted = true;
          status = AchievementStatus.UNLOCKED;
          if (!completedAt) {
            completedAt = new Date().toISOString();
          }
        } else if (currentProgress > 0) {
          status = AchievementStatus.IN_PROGRESS;
        } else {
          status = AchievementStatus.LOCKED;
        }
      } else {
        if (isRewardClaimed) {
          status = AchievementStatus.CLAIMED;
        } else {
          status = AchievementStatus.UNLOCKED;
        }
      }

      // Aggregate counters for summary statistics
      if (status === AchievementStatus.CLAIMED) {
        totalClaimedXp += def.xpReward;
      } else if (status === AchievementStatus.UNLOCKED) {
        unlockedCount++;
        unclaimedRewardsCount++;
      } else if (status === AchievementStatus.IN_PROGRESS) {
        inProgressCount++;
      } else {
        lockedCount++;
      }

      // Normalized Progress Percentage (clamped to 0 - 100)
      const { progressPercent } = this.evaluationService.calculateProgress(
        currentProgress,
        targetVal,
      );

      const item: UserAchievementItemDto = {
        id: def.id,
        category: def.category,
        tier: def.tier,
        title: def.title,
        description: def.description,
        requirementText: def.requirementText,
        metricKey: def.metricKey,
        currentProgress,
        targetValue: targetVal,
        progressPercent,
        progressText: this.formatProgressText(
          currentProgress,
          targetVal,
          def.metricKey,
        ),
        status,
        xpReward: def.xpReward,
        rewardValue: `+${def.xpReward.toLocaleString()} XP`,
        isCompleted,
        isRewardClaimed,
        badgeAssetKey: def.badgeAssetKey,
        badgeUrl: def.badgeAssetKey,
        completedAt,
        claimedAt,
      };

      items.push(item);
    }

    // Build unified summary statistics
    const summary: AchievementSummaryDto = {
      totalAchievements: definitions.length,
      unlockedCount,
      inProgressCount,
      lockedCount,
      totalXpEarned: userPointsTotals.totalPoints,
      unclaimedRewardsCount,
      currentLevel: userPointsTotals.level,
      currentLevelName: userPointsTotals.levelName || 'Bronze',
      nextLevelPoints: userPointsTotals.nextLevelPoints,
      levelProgress: userPointsTotals.levelProgress,
    };

    // Apply optional category and status filters
    let filteredItems = items;
    if (filter?.category) {
      filteredItems = filteredItems.filter(
        (item) => item.category === filter.category,
      );
    }
    if (filter?.status) {
      filteredItems = filteredItems.filter(
        (item) => item.status === filter.status,
      );
    }

    return {
      summary,
      achievements: filteredItems,
    };
  }

  /**
   * Safe achievement reward claim endpoint (delegates to AchievementRewardService).
   */
  async claimAchievementReward(
    userId: string,
    achievementId: string,
  ): Promise<ClaimAchievementResponseDto> {
    return this.rewardService.claimAchievementReward(userId, achievementId);
  }

  /**
   * Match Event Integration (delegates to AchievementAggregatorService)
   */
  async recordMatchParticipation(
    userId: string,
    matchesCount = 1,
    options?: { matchId?: string; isRecorded?: boolean; sport?: string; turfId?: string },
  ) {
    return this.aggregatorService.recordMatchParticipation(userId, matchesCount, options);
  }

  /**
   * Goal Event Integration (delegates to AchievementAggregatorService)
   */
  async recordGoalScored(
    userId: string,
    goalsCount = 1,
    options?: { matchId?: string; highlightId?: string },
  ) {
    return this.aggregatorService.recordGoalScored(userId, goalsCount, options);
  }

  /**
   * MVP Event Integration (delegates to AchievementAggregatorService)
   */
  async recordMvpAwarded(
    userId: string,
    count = 1,
    options?: { matchId?: string; tournamentId?: string },
  ) {
    return this.aggregatorService.recordMvpAwarded(userId, count, options);
  }

  /**
   * Match Streak Event Integration (delegates to AchievementAggregatorService)
   */
  async recordStreakUpdated(
    userId: string,
    streakDays?: number,
    matchWinStreak?: number,
  ) {
    return this.aggregatorService.recordStreakUpdated(userId, streakDays, matchWinStreak);
  }

  /**
   * Task 36: FlickShort Upload Event Integration
   */
  async recordShortUploaded(
    userId: string,
    count = 1,
    options?: { shortId?: string; recordingId?: string },
  ) {
    return this.aggregatorService.recordShortUploaded(userId, count, options);
  }

  /**
   * Task 37: FlickShort Like Event Integration
   */
  async recordShortLiked(
    userId: string,
    likesCount: number,
    options?: { shortId?: string },
  ) {
    return this.aggregatorService.recordShortLiked(userId, likesCount, options);
  }

  /**
   * Task 38: FlickShort Share Event Integration
   */
  async recordShortShared(
    userId: string,
    sharesCount: number,
    options?: { shortId?: string },
  ) {
    return this.aggregatorService.recordShortShared(userId, sharesCount, options);
  }

  /**
   * Task 39: FlickShort View Event Integration
   */
  async recordShortViewed(
    userId: string,
    viewsCount: number,
    options?: { shortId?: string },
  ) {
    return this.aggregatorService.recordShortViewed(userId, viewsCount, options);
  }

  /**
   * Task 40: Teammates / Social Connection Event Integration
   */
  async recordTeammatesConnected(
    userId: string,
    count = 1,
    options?: { teammateUserId?: string; totalCount?: number; circleId?: string },
  ) {
    return this.aggregatorService.recordTeammatesConnected(userId, count, options);
  }

  /**
   * Social Metric Event Integration (teammates, messages, referrals)
   */
  async recordSocialMetric(
    userId: string,
    type: 'teammates' | 'messages' | 'referrals',
    value: number,
  ) {
    return this.aggregatorService.recordSocialMetric(userId, type, value);
  }

  /**
   * Flush metrics buffer
   */
  async flushMetricsBuffer() {
    return this.bufferService.flushMetrics();
  }

  /**
   * Get buffer stats
   */
  getBufferStats() {
    return this.bufferService.getBufferStats();
  }
}
