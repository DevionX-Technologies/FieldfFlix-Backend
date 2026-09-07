import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserPoints } from '../points/entities/user-points.entity';
import { PointsService } from '../points/points.service';
import { PointEventType } from '../points/entities/point-event.entity';
import { APPROVED_ACHIEVEMENT_DEFINITIONS } from '../constant/achievement-catalog.constant';
import {
  AchievementCategory,
  AchievementStatus,
  AchievementTier,
} from '../interface/achievement.interface';
import { AchievementQueryDto } from './dto/achievement-query.dto';
import {
  AchievementSummaryDto,
  ClaimAchievementResponseDto,
  GetAchievementsResponseDto,
  UserAchievementItemDto,
} from './dto/achievement-response.dto';

@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AchievementDefinition)
    private readonly definitionRepo: Repository<AchievementDefinition>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(UserAchievementMetrics)
    private readonly metricsRepo: Repository<UserAchievementMetrics>,
    @InjectRepository(UserPoints)
    private readonly userPointsRepo: Repository<UserPoints>,
    private readonly pointsService: PointsService,
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
   * Resolve live telemetry metric value from UserAchievementMetrics or user level.
   */
  public getTelemetryMetricValue(
    metrics: UserAchievementMetrics | null,
    metricKey: string,
    userLevel = 1,
  ): number {
    if (metricKey === 'player_level') {
      return userLevel;
    }

    if (!metrics) {
      return 0;
    }

    switch (metricKey) {
      // Athlete
      case 'matches_played':
        return Number(metrics.matchesPlayed ?? 0);
      case 'goals_scored':
        return Number(metrics.goalsScored ?? 0);
      case 'mvp_matches_count':
        return Number(metrics.mvpMatchesCount ?? 0);
      case 'streak_days':
        return Number(metrics.streakDays ?? 0);
      case 'match_win_streak':
        return Number(metrics.matchWinStreak ?? 0);

      // Creator
      case 'flickshorts_uploaded_count':
        return Number(metrics.flickshortsUploadedCount ?? 0);
      case 'peak_likes_single_short':
        return Number(metrics.peakLikesSingleShort ?? 0);
      case 'peak_shares_single_short':
        return Number(metrics.peakSharesSingleShort ?? 0);
      case 'peak_views_single_short':
        return Number(metrics.peakViewsSingleShort ?? 0);

      // Social
      case 'teammates_connected_count':
        return Number(metrics.teammatesConnectedCount ?? 0);
      case 'crew_watch_rank':
        return metrics.crewWatchRank === 1 ? 1 : 0;
      case 'referrals_completed_count':
        return Number(metrics.referralsCompletedCount ?? 0);
      case 'messages_sent_count':
        return Number(metrics.messagesSentCount ?? 0);
      case 'social_rank_percentile':
        return Number(metrics.socialRankPercentile ?? 100) <= 1 ? 1 : 0;

      // Special
      case 'matches_recorded_count':
        return Number(metrics.matchesRecordedCount ?? 0);
      case 'highlights_created_count':
        return Number(metrics.highlightsCreatedCount ?? 0);
      case 'user_signup_sequence':
        return metrics.userSignupSequence && metrics.userSignupSequence <= 1000
          ? 1000
          : 0;
      case 'beta_tester_flag':
        return metrics.betaTesterFlag ? 1 : 0;
      case 'lifetime_legend_flag':
        return metrics.lifetimeLegendFlag ? 1 : 0;
      case 'fast_start_flag':
        return metrics.fastStartFlag ? 1 : 0;
      case 'exceptional_competitive_flag':
        return metrics.exceptionalCompetitiveFlag ? 1 : 0;
      case 'standout_content_flag':
        return metrics.standoutContentFlag ? 1 : 0;
      case 'community_notable_flag':
        return metrics.communityNotableFlag ? 1 : 0;
      case 'sustained_activity_flag':
        return metrics.sustainedActivityFlag ? 1 : 0;
      case 'community_icon_flag':
        return metrics.communityIconFlag ? 1 : 0;
      case 'legacy_contribution_flag':
        return metrics.legacyContributionFlag ? 1 : 0;

      default:
        return 0;
    }
  }

  /**
   * Format human-readable progress counter string for UI cards.
   */
  public formatProgressText(
    current: number,
    target: number,
    metricKey: string,
  ): string {
    const clampedCurrent = Math.min(current, target);

    switch (metricKey) {
      case 'matches_played':
      case 'matches_recorded_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Match' : 'Matches'}`;
      case 'goals_scored':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Goal' : 'Goals'}`;
      case 'streak_days':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Day' : 'Days'}`;
      case 'mvp_matches_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'MVP' : 'MVPs'}`;
      case 'flickshorts_uploaded_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Short' : 'Shorts'}`;
      case 'peak_likes_single_short':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Like' : 'Likes'}`;
      case 'peak_shares_single_short':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Share' : 'Shares'}`;
      case 'peak_views_single_short':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'View' : 'Views'}`;
      case 'teammates_connected_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Teammate' : 'Teammates'}`;
      case 'referrals_completed_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Friend' : 'Friends'}`;
      case 'messages_sent_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Message' : 'Messages'}`;
      case 'highlights_created_count':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Highlight' : 'Highlights'}`;
      case 'player_level':
        return `Level ${clampedCurrent} / ${target}`;
      default:
        return `${clampedCurrent} / ${target}`;
    }
  }

  /**
   * Task 17 & 18: Main GET Achievements endpoint with normalized response DTO and summary statistics.
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

    // 2. Fetch user's achievements and telemetry metrics
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
      const progressPercent =
        targetVal > 0
          ? Math.min(100, Math.max(0, Math.floor((currentProgress / targetVal) * 100)))
          : 100;

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
   * Task 19 & 20: Safe achievement reward claim endpoint with server-side completion validation,
   * transactional row locking, idempotency, points award, and standardized error handling.
   */
  async claimAchievementReward(
    userId: string,
    achievementId: string,
  ): Promise<ClaimAchievementResponseDto> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!achievementId) {
      throw new BadRequestException('Achievement ID is required');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. Verify achievement definition exists
      const definition = await manager
        .getRepository(AchievementDefinition)
        .findOne({ where: { id: achievementId } });

      if (!definition) {
        throw new NotFoundException(
          `Achievement '${achievementId}' does not exist`,
        );
      }

      // 2. Fetch or initialize user achievement record with row locking
      let ua = await manager
        .getRepository(UserAchievement)
        .createQueryBuilder('ua')
        .setLock('pessimistic_write')
        .where('ua.userId = :userId AND ua.achievementId = :achievementId', {
          userId,
          achievementId,
        })
        .getOne();

      // Invariant 5.3: Idempotent claim check (reject double-claims)
      if (ua && (ua.isRewardClaimed || ua.status === AchievementStatus.CLAIMED)) {
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
      const telemetryValue = this.getTelemetryMetricValue(
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
          currentProgress: effectiveProgress,
          targetValue: targetVal,
          status: AchievementStatus.CLAIMED,
          isCompleted: true,
          completedAt: now,
          isRewardClaimed: true,
          claimedAt: now,
        });
      } else {
        ua.currentProgress = effectiveProgress;
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
