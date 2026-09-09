import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AchievementDefinition } from '../entities/achievement-definition.entity';
import { UserAchievement } from '../entities/user-achievement.entity';
import { UserAchievementMetrics } from '../entities/user-achievement-metrics.entity';
import { AchievementUnlockedEvent } from '../events/achievement-unlocked.event';
import {
  AchievementCategory,
  AchievementStatus,
} from 'src/interface/achievement.interface';

export interface EvaluationResult {
  userId: string;
  evaluatedCount: number;
  newlyUnlockedIds: string[];
  achievements: UserAchievement[];
}

@Injectable()
export class AchievementEvaluationService {
  private readonly logger = new Logger(AchievementEvaluationService.name);

  constructor(
    @InjectRepository(AchievementDefinition)
    private readonly definitionRepo: Repository<AchievementDefinition>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(UserAchievementMetrics)
    private readonly metricsRepo: Repository<UserAchievementMetrics>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Task 5: Server-side Progress & Percentage Calculation
   */
  public calculateProgress(
    currentValue: number,
    targetValue: number,
  ): {
    clampedCurrent: number;
    progressPercent: number;
    isCompleted: boolean;
  } {
    const safeTarget = Math.max(1, Number(targetValue) || 1);
    const safeCurrent = Math.max(0, Number(currentValue) || 0);
    const isCompleted = safeCurrent >= safeTarget;
    const progressPercent = Math.min(
      100,
      Math.max(0, Math.floor((safeCurrent / safeTarget) * 100)),
    );

    return {
      clampedCurrent: safeCurrent,
      progressPercent,
      isCompleted,
    };
  }

  /**
   * Format human-readable progress counter string for UI display.
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
      case 'match_win_streak':
        return `${clampedCurrent} / ${target} ${target === 1 ? 'Win' : 'Wins'}`;
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
   * Resolves raw numeric telemetry value from metrics entity or player level.
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
   * Task 4 & 6: Evaluation & Idempotent Completion Processing
   * Evaluates user metrics against achievement definitions, updates state transitions,
   * prevents duplicate unlocks, and emits AchievementUnlockedEvent for newly completed achievements.
   */
  async evaluateUser(
    userId: string,
    options?: {
      specificMetricKey?: string;
      category?: AchievementCategory;
      userLevel?: number;
      metrics?: UserAchievementMetrics | null;
    },
  ): Promise<EvaluationResult> {
    if (!userId) {
      return { userId, evaluatedCount: 0, newlyUnlockedIds: [], achievements: [] };
    }

    const whereDef: any = { isActive: true };
    if (options?.category) {
      whereDef.category = options.category;
    }
    if (options?.specificMetricKey) {
      whereDef.metricKey = options.specificMetricKey;
    }

    const [definitions, existingUAs, metrics] = await Promise.all([
      this.definitionRepo.find({ where: whereDef, order: { displayOrder: 'ASC' } }),
      this.userAchievementRepo.find({ where: { userId } }),
      options?.metrics !== undefined
        ? Promise.resolve(options.metrics)
        : this.metricsRepo.findOne({ where: { userId } }),
    ]);

    const userAchievementMap = new Map<string, UserAchievement>();
    for (const ua of existingUAs) {
      userAchievementMap.set(ua.achievementId, ua);
    }

    const userLevel = options?.userLevel ?? 1;
    const newlyUnlockedIds: string[] = [];
    const entitiesToSave: UserAchievement[] = [];
    const eventsToDispatch: AchievementUnlockedEvent[] = [];
    const now = new Date();

    for (const def of definitions) {
      const targetVal = Number(def.targetValue);
      const telemetryVal = this.getTelemetryMetricValue(metrics, def.metricKey, userLevel);
      let ua = userAchievementMap.get(def.id);

      // Invariant 5.1: Non-regression monotonic progression
      let currentProgress = ua ? Number(ua.currentProgress) : 0;
      let isCompleted = ua ? Boolean(ua.isCompleted) : false;
      let isRewardClaimed = ua ? Boolean(ua.isRewardClaimed) : false;

      // If already claimed, status remains CLAIMED and completed remains true
      if (isRewardClaimed) {
        currentProgress = Math.max(currentProgress, telemetryVal, targetVal);
        continue;
      }

      // If previously completed (UNLOCKED), ensure progress doesn't regress
      if (isCompleted) {
        currentProgress = Math.max(currentProgress, telemetryVal, targetVal);
        continue;
      }

      // Monotonic progression update
      currentProgress = Math.max(currentProgress, telemetryVal);
      const isNowCompleted = currentProgress >= targetVal;

      let nextStatus: AchievementStatus;
      let shouldSave = false;

      if (isNowCompleted) {
        // T4: Transition to UNLOCKED
        nextStatus = AchievementStatus.UNLOCKED;
        isCompleted = true;
        newlyUnlockedIds.push(def.id);
        shouldSave = true;

        eventsToDispatch.push(
          new AchievementUnlockedEvent(
            userId,
            def.id,
            def.title,
            def.description,
            def.category,
            def.tier,
            def.xpReward,
            def.badgeAssetKey,
            now,
          ),
        );
      } else if (currentProgress > 0) {
        // T2 / T3: Transition to / remain IN_PROGRESS
        nextStatus = AchievementStatus.IN_PROGRESS;
        if (!ua || ua.currentProgress !== currentProgress || ua.status !== nextStatus) {
          shouldSave = true;
        }
      } else {
        // T1: LOCKED
        nextStatus = AchievementStatus.LOCKED;
        if (!ua || ua.status !== nextStatus) {
          shouldSave = true;
        }
      }

      if (shouldSave) {
        if (!ua) {
          ua = this.userAchievementRepo.create({
            userId,
            achievementId: def.id,
            currentProgress,
            targetValue: targetVal,
            status: nextStatus,
            isCompleted,
            completedAt: isCompleted ? now : null,
            isRewardClaimed: false,
            claimedAt: null,
          });
        } else {
          ua.currentProgress = currentProgress;
          ua.targetValue = targetVal;
          ua.status = nextStatus;
          ua.isCompleted = isCompleted;
          if (isCompleted && !ua.completedAt) {
            ua.completedAt = now;
          }
        }
        entitiesToSave.push(ua);
        userAchievementMap.set(def.id, ua);
      }
    }

    if (entitiesToSave.length > 0) {
      await this.userAchievementRepo.save(entitiesToSave);
      this.logger.debug(
        `Updated ${entitiesToSave.length} user achievements for ${userId}. Unlocked: [${newlyUnlockedIds.join(', ')}]`,
      );
    }

    // Dispatch unlock events (Task 11)
    for (const evt of eventsToDispatch) {
      try {
        this.eventEmitter.emit(AchievementUnlockedEvent.EVENT_NAME, evt);
      } catch (err) {
        this.logger.error(
          `Failed to emit AchievementUnlockedEvent for ${evt.achievementId}: ${(err as Error)?.message}`,
        );
      }
    }

    return {
      userId,
      evaluatedCount: definitions.length,
      newlyUnlockedIds,
      achievements: Array.from(userAchievementMap.values()),
    };
  }
}
