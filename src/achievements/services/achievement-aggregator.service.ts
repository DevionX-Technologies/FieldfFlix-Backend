import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserAchievementMetrics } from '../entities/user-achievement-metrics.entity';
import {
  AchievementMetricsBufferService,
  BufferedMetricDelta,
} from './achievement-metrics-buffer.service';
import { AchievementEvaluationService } from './achievement-evaluation.service';
import { PointsService } from 'src/points/points.service';

@Injectable()
export class AchievementAggregatorService implements OnModuleInit {
  private readonly logger = new Logger(AchievementAggregatorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(UserAchievementMetrics)
    private readonly metricsRepo: Repository<UserAchievementMetrics>,
    private readonly bufferService: AchievementMetricsBufferService,
    private readonly evaluationService: AchievementEvaluationService,
    private readonly pointsService: PointsService,
  ) {}

  onModuleInit(): void {
    // Register flush callback to persist Redis buffered deltas into PostgreSQL
    this.bufferService.registerFlushListener(async (deltas) => {
      await this.persistBufferedDeltas(deltas);
    });
  }

  /**
   * Helper: Get or initialize metrics row for user
   */
  async getOrCreateUserMetrics(
    userId: string,
  ): Promise<UserAchievementMetrics> {
    let metrics = await this.metricsRepo.findOne({ where: { userId } });
    if (!metrics) {
      metrics = this.metricsRepo.create({
        userId,
        matchesPlayed: 0,
        goalsScored: 0,
        mvpMatchesCount: 0,
        streakDays: 0,
        matchWinStreak: 0,
        flickshortsUploadedCount: 0,
        peakLikesSingleShort: 0,
        peakSharesSingleShort: 0,
        peakViewsSingleShort: 0,
        teammatesConnectedCount: 0,
        crewWatchRank: 999,
        referralsCompletedCount: 0,
        messagesSentCount: 0,
        socialRankPercentile: 100.0,
        matchesRecordedCount: 0,
        highlightsCreatedCount: 0,
        betaTesterFlag: false,
        lifetimeLegendFlag: false,
        fastStartFlag: false,
        exceptionalCompetitiveFlag: false,
        standoutContentFlag: false,
        communityNotableFlag: false,
        sustainedActivityFlag: false,
        communityIconFlag: false,
        legacyContributionFlag: false,
      });
      metrics = await this.metricsRepo.save(metrics);
    }
    return metrics;
  }

  /**
   * Persist flushed deltas from Redis/memory buffer directly into PostgreSQL
   */
  async persistBufferedDeltas(deltas: BufferedMetricDelta[]): Promise<void> {
    if (!deltas || deltas.length === 0) return;

    for (const delta of deltas) {
      const { userId, increments, peaks, flags } = delta;
      try {
        await this.dataSource.transaction(async (manager) => {
          let metrics = await manager
            .getRepository(UserAchievementMetrics)
            .findOne({ where: { userId } });

          if (!metrics) {
            metrics = manager.getRepository(UserAchievementMetrics).create({
              userId,
              matchesPlayed: 0,
              goalsScored: 0,
              mvpMatchesCount: 0,
              streakDays: 0,
              matchWinStreak: 0,
              flickshortsUploadedCount: 0,
              peakLikesSingleShort: 0,
              peakSharesSingleShort: 0,
              peakViewsSingleShort: 0,
              teammatesConnectedCount: 0,
              crewWatchRank: 999,
              referralsCompletedCount: 0,
              messagesSentCount: 0,
              socialRankPercentile: 100.0,
              matchesRecordedCount: 0,
              highlightsCreatedCount: 0,
            });
          }

          // Apply increments
          if (increments.matches_played)
            metrics.matchesPlayed += increments.matches_played;
          if (increments.goals_scored)
            metrics.goalsScored += increments.goals_scored;
          if (increments.mvp_matches_count)
            metrics.mvpMatchesCount += increments.mvp_matches_count;
          if (increments.flickshorts_uploaded_count)
            metrics.flickshortsUploadedCount +=
              increments.flickshorts_uploaded_count;
          if (increments.teammates_connected_count)
            metrics.teammatesConnectedCount +=
              increments.teammates_connected_count;
          if (increments.referrals_completed_count)
            metrics.referralsCompletedCount +=
              increments.referrals_completed_count;
          if (increments.messages_sent_count)
            metrics.messagesSentCount += increments.messages_sent_count;
          if (increments.matches_recorded_count)
            metrics.matchesRecordedCount += increments.matches_recorded_count;
          if (increments.highlights_created_count)
            metrics.highlightsCreatedCount +=
              increments.highlights_created_count;

          // Apply peaks (GREATEST)
          if (peaks.peak_likes_single_short !== undefined) {
            metrics.peakLikesSingleShort = Math.max(
              Number(metrics.peakLikesSingleShort || 0),
              peaks.peak_likes_single_short,
            );
          }
          if (peaks.peak_shares_single_short !== undefined) {
            metrics.peakSharesSingleShort = Math.max(
              Number(metrics.peakSharesSingleShort || 0),
              peaks.peak_shares_single_short,
            );
          }
          if (peaks.peak_views_single_short !== undefined) {
            metrics.peakViewsSingleShort = Math.max(
              Number(metrics.peakViewsSingleShort || 0),
              peaks.peak_views_single_short,
            );
          }
          if (peaks.streak_days !== undefined) {
            metrics.streakDays = Math.max(
              Number(metrics.streakDays || 0),
              peaks.streak_days,
            );
          }
          if (peaks.match_win_streak !== undefined) {
            metrics.matchWinStreak = Math.max(
              Number(metrics.matchWinStreak || 0),
              peaks.match_win_streak,
            );
          }

          // Apply flags
          if (flags.beta_tester_flag !== undefined)
            metrics.betaTesterFlag = flags.beta_tester_flag;
          if (flags.lifetime_legend_flag !== undefined)
            metrics.lifetimeLegendFlag = flags.lifetime_legend_flag;
          if (flags.fast_start_flag !== undefined)
            metrics.fastStartFlag = flags.fast_start_flag;
          if (flags.exceptional_competitive_flag !== undefined)
            metrics.exceptionalCompetitiveFlag =
              flags.exceptional_competitive_flag;
          if (flags.standout_content_flag !== undefined)
            metrics.standoutContentFlag = flags.standout_content_flag;
          if (flags.community_notable_flag !== undefined)
            metrics.communityNotableFlag = flags.community_notable_flag;
          if (flags.sustained_activity_flag !== undefined)
            metrics.sustainedActivityFlag = flags.sustained_activity_flag;
          if (flags.community_icon_flag !== undefined)
            metrics.communityIconFlag = flags.community_icon_flag;
          if (flags.legacy_contribution_flag !== undefined)
            metrics.legacyContributionFlag = flags.legacy_contribution_flag;

          await manager.getRepository(UserAchievementMetrics).save(metrics);
        });

        // Trigger evaluation for the user after flushing
        const totals = await this.pointsService.getMyTotals(userId);
        await this.evaluationService.evaluateUser(userId, {
          userLevel: totals.level,
        });
      } catch (err) {
        this.logger.error(
          `Failed to persist buffered delta for user ${userId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  /**
   * Task 12: Integrate Match Events
   * Connect match participation events to Athlete match-count achievements
   * (ATH_TURF_DEBUT, ATH_REGULAR_STARTER, ATH_CENTURION, SPC_CAPTURE_MASTER)
   */
  async recordMatchParticipation(
    userId: string,
    matchesCount = 1,
    options?: {
      matchId?: string;
      isRecorded?: boolean;
      sport?: string;
      turfId?: string;
    },
  ): Promise<{ totalMatchesPlayed: number; unlockedAchievements: string[] }> {
    if (!userId) return { totalMatchesPlayed: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    metrics.matchesPlayed = Number(metrics.matchesPlayed || 0) + matchesCount;

    if (options?.isRecorded) {
      metrics.matchesRecordedCount =
        Number(metrics.matchesRecordedCount || 0) + matchesCount;
    }

    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    this.logger.log(
      `Recorded match participation for user ${userId}: +${matchesCount} match(es). Total: ${metrics.matchesPlayed}`,
    );

    return {
      totalMatchesPlayed: metrics.matchesPlayed,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }

  /**
   * Task 13: Integrate Goal Events
   * Connect goal-scoring events to Sharp Shooter (ATH_SHARP_SHOOTER) and Goal Machine (ATH_GOAL_MACHINE)
   */
  async recordGoalScored(
    userId: string,
    goalsCount = 1,
    options?: { matchId?: string; highlightId?: string },
  ): Promise<{ totalGoalsScored: number; unlockedAchievements: string[] }> {
    if (!userId || goalsCount <= 0)
      return { totalGoalsScored: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    metrics.goalsScored = Number(metrics.goalsScored || 0) + goalsCount;
    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    this.logger.log(
      `Recorded goal scored for user ${userId}: +${goalsCount} goal(s). Total: ${metrics.goalsScored}${
        options?.matchId ? ` (match: ${options.matchId})` : ''
      }`,
    );

    return {
      totalGoalsScored: metrics.goalsScored,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }

  /**
   * Task 14: Integrate MVP Events
   * Connect MVP results to MVP (ATH_MVP) and Turf Legend (ATH_TURF_LEGEND) progression
   */
  async recordMvpAwarded(
    userId: string,
    count = 1,
    options?: { matchId?: string; tournamentId?: string },
  ): Promise<{ totalMvpMatchesCount: number; unlockedAchievements: string[] }> {
    if (!userId || count <= 0)
      return { totalMvpMatchesCount: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    metrics.mvpMatchesCount = Number(metrics.mvpMatchesCount || 0) + count;
    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    this.logger.log(
      `Recorded MVP award for user ${userId}: +${count} MVP(s). Total: ${metrics.mvpMatchesCount}${
        options?.matchId ? ` (match: ${options.matchId})` : ''
      }`,
    );

    return {
      totalMvpMatchesCount: metrics.mvpMatchesCount,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }

  /**
   * Task 15: Integrate Match Streak Events
   * Connect win/activity streak information to Consistent Player (ATH_CONSISTENT_PLAYER),
   * 7 Day Streak (SPC_7_DAY_STREAK), 30 Day Streak (SPC_30_DAY_STREAK), Hot Streak (SPC_HOT_STREAK), Perfect Run (SPC_PERFECT_RUN)
   */
  async recordStreakUpdated(
    userId: string,
    streakDays?: number,
    matchWinStreak?: number,
  ): Promise<{
    streakDays: number;
    matchWinStreak: number;
    unlockedAchievements: string[];
  }> {
    if (!userId)
      return { streakDays: 0, matchWinStreak: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);

    if (streakDays !== undefined && streakDays >= 0) {
      metrics.streakDays = streakDays;
    }
    if (matchWinStreak !== undefined && matchWinStreak >= 0) {
      metrics.matchWinStreak = matchWinStreak;
    }

    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    this.logger.log(
      `Updated streaks for user ${userId}: streakDays=${metrics.streakDays}, matchWinStreak=${metrics.matchWinStreak}`,
    );

    return {
      streakDays: metrics.streakDays,
      matchWinStreak: metrics.matchWinStreak,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }

  /**
   * Task 36: Integrate FlickShort Upload Events
   * Connect FlickShort upload events to Creator upload achievements
   * (CRE_FIRST_REEL, CRE_HIGHLIGHT_REEL, CRE_CONTENT_MACHINE)
   */
  async recordShortUploaded(
    userId: string,
    count = 1,
    options?: { shortId?: string; recordingId?: string },
  ): Promise<{ totalUploaded: number; unlockedAchievements: string[] }> {
    if (!userId || count <= 0)
      return { totalUploaded: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    metrics.flickshortsUploadedCount =
      Number(metrics.flickshortsUploadedCount || 0) + count;
    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    this.logger.log(
      `Recorded FlickShort upload for creator ${userId}: +${count} short(s). Total: ${metrics.flickshortsUploadedCount}${
        options?.shortId ? ` (short: ${options.shortId})` : ''
      }`,
    );

    return {
      totalUploaded: metrics.flickshortsUploadedCount,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }

  /**
   * Task 37: Integrate FlickShort Like Events
   * Connect like peaks on a short to Crowd Pleaser (CRE_CROWD_PLEASER) and Viral Sensation (CRE_VIRAL_SENSATION)
   */
  async recordShortLiked(
    userId: string,
    likesCount: number,
    options?: { shortId?: string },
  ): Promise<{ peakLikesSingleShort: number; unlockedAchievements: string[] }> {
    if (!userId || likesCount < 0)
      return { peakLikesSingleShort: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    if (likesCount > Number(metrics.peakLikesSingleShort || 0)) {
      metrics.peakLikesSingleShort = likesCount;
      await this.metricsRepo.save(metrics);

      const totals = await this.pointsService.getMyTotals(userId);
      const evalResult = await this.evaluationService.evaluateUser(userId, {
        userLevel: totals.level,
        metrics,
      });

      this.logger.log(
        `Recorded FlickShort likes peak for creator ${userId}: peakLikesSingleShort=${metrics.peakLikesSingleShort}${
          options?.shortId ? ` (short: ${options.shortId})` : ''
        }`,
      );

      return {
        peakLikesSingleShort: metrics.peakLikesSingleShort,
        unlockedAchievements: evalResult.newlyUnlockedIds,
      };
    }

    if (options?.shortId) {
      this.logger.debug?.(`FlickShort ${options.shortId} like below peak`);
    }

    return {
      peakLikesSingleShort: Number(metrics.peakLikesSingleShort || 0),
      unlockedAchievements: [],
    };
  }

  /**
   * Task 38: Integrate FlickShort Share Events
   * Connect share peaks on a short to Trending Clip (CRE_TRENDING_CLIP) and Share Magnet (CRE_SHARE_MAGNET)
   */
  async recordShortShared(
    userId: string,
    sharesCount: number,
    options?: { shortId?: string },
  ): Promise<{
    peakSharesSingleShort: number;
    unlockedAchievements: string[];
  }> {
    if (!userId || sharesCount < 0)
      return { peakSharesSingleShort: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    if (sharesCount > Number(metrics.peakSharesSingleShort || 0)) {
      metrics.peakSharesSingleShort = sharesCount;
      await this.metricsRepo.save(metrics);

      const totals = await this.pointsService.getMyTotals(userId);
      const evalResult = await this.evaluationService.evaluateUser(userId, {
        userLevel: totals.level,
        metrics,
      });

      this.logger.log(
        `Recorded FlickShort shares peak for creator ${userId}: peakSharesSingleShort=${metrics.peakSharesSingleShort}${
          options?.shortId ? ` (short: ${options.shortId})` : ''
        }`,
      );

      return {
        peakSharesSingleShort: metrics.peakSharesSingleShort,
        unlockedAchievements: evalResult.newlyUnlockedIds,
      };
    }

    if (options?.shortId) {
      this.logger.debug?.(`FlickShort ${options.shortId} share below peak`);
    }

    return {
      peakSharesSingleShort: Number(metrics.peakSharesSingleShort || 0),
      unlockedAchievements: [],
    };
  }

  /**
   * Task 39: Integrate FlickShort View Events
   * Connect cumulative or peak views on shorts to Reel Legend (CRE_REEL_LEGEND)
   */
  async recordShortViewed(
    userId: string,
    viewsCount: number,
    options?: { shortId?: string },
  ): Promise<{ peakViewsSingleShort: number; unlockedAchievements: string[] }> {
    if (!userId || viewsCount < 0)
      return { peakViewsSingleShort: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    if (viewsCount > Number(metrics.peakViewsSingleShort || 0)) {
      metrics.peakViewsSingleShort = viewsCount;
      await this.metricsRepo.save(metrics);

      const totals = await this.pointsService.getMyTotals(userId);
      const evalResult = await this.evaluationService.evaluateUser(userId, {
        userLevel: totals.level,
        metrics,
      });

      this.logger.log(
        `Recorded FlickShort views peak for creator ${userId}: peakViewsSingleShort=${metrics.peakViewsSingleShort}${
          options?.shortId ? ` (short: ${options.shortId})` : ''
        }`,
      );

      return {
        peakViewsSingleShort: Number(metrics.peakViewsSingleShort || 0),
        unlockedAchievements: evalResult.newlyUnlockedIds,
      };
    }

    if (options?.shortId) {
      this.logger.debug?.(`FlickShort ${options.shortId} view below peak`);
    }

    return {
      peakViewsSingleShort: Number(metrics.peakViewsSingleShort || 0),
      unlockedAchievements: [],
    };
  }

  /**
   * Task 40: Integrate Teammate / Social Connection Events
   * Connect teammate connections to Squad Builder (SOC_SQUAD_BUILDER), Team Captain (SOC_TEAM_CAPTAIN),
   * Club Legend (SOC_CLUB_LEGEND), Network King (SOC_NETWORK_KING), Matchmaker (SPC_MATCHMAKER)
   */
  async recordTeammatesConnected(
    userId: string,
    count = 1,
    options?: {
      teammateUserId?: string;
      totalCount?: number;
      circleId?: string;
    },
  ): Promise<{
    totalTeammatesConnected: number;
    unlockedAchievements: string[];
  }> {
    if (!userId)
      return { totalTeammatesConnected: 0, unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    if (options?.totalCount !== undefined && options.totalCount >= 0) {
      metrics.teammatesConnectedCount = Math.max(
        Number(metrics.teammatesConnectedCount || 0),
        options.totalCount,
      );
    } else if (count > 0) {
      metrics.teammatesConnectedCount =
        Number(metrics.teammatesConnectedCount || 0) + count;
    }

    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    this.logger.log(
      `Recorded teammate connection for user ${userId}: count=${count}, total=${metrics.teammatesConnectedCount}`,
    );

    return {
      totalTeammatesConnected: metrics.teammatesConnectedCount,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }

  /**
   * Creator Peak Stats Integration: Likes, Shares, Views (unified helper)
   */
  async recordShortStats(
    userId: string,
    stats: { likes?: number; shares?: number; views?: number },
  ): Promise<{ unlockedAchievements: string[] }> {
    if (!userId) return { unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);
    let changed = false;

    if (
      stats.likes !== undefined &&
      stats.likes > Number(metrics.peakLikesSingleShort || 0)
    ) {
      metrics.peakLikesSingleShort = stats.likes;
      changed = true;
    }
    if (
      stats.shares !== undefined &&
      stats.shares > Number(metrics.peakSharesSingleShort || 0)
    ) {
      metrics.peakSharesSingleShort = stats.shares;
      changed = true;
    }
    if (
      stats.views !== undefined &&
      stats.views > Number(metrics.peakViewsSingleShort || 0)
    ) {
      metrics.peakViewsSingleShort = stats.views;
      changed = true;
    }

    if (changed) {
      await this.metricsRepo.save(metrics);
      const totals = await this.pointsService.getMyTotals(userId);
      const evalResult = await this.evaluationService.evaluateUser(userId, {
        userLevel: totals.level,
        metrics,
      });
      return { unlockedAchievements: evalResult.newlyUnlockedIds };
    }

    return { unlockedAchievements: [] };
  }

  /**
   * Social Telemetry Integration: Connected teammates, messages, referrals
   */
  async recordSocialMetric(
    userId: string,
    type: 'teammates' | 'messages' | 'referrals',
    value: number,
  ): Promise<{ unlockedAchievements: string[] }> {
    if (!userId) return { unlockedAchievements: [] };

    const metrics = await this.getOrCreateUserMetrics(userId);

    if (type === 'teammates') {
      metrics.teammatesConnectedCount = Math.max(
        Number(metrics.teammatesConnectedCount || 0),
        value,
      );
    } else if (type === 'messages') {
      metrics.messagesSentCount =
        Number(metrics.messagesSentCount || 0) + value;
    } else if (type === 'referrals') {
      metrics.referralsCompletedCount =
        Number(metrics.referralsCompletedCount || 0) + value;
    }

    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    return { unlockedAchievements: evalResult.newlyUnlockedIds };
  }

  /**
   * Generic Ingest with Redis buffer or direct DB write
   */
  async ingestMetric(args: {
    userId: string;
    metricKey: string;
    incrementBy?: number;
    value?: number;
    flagValue?: boolean;
    useBuffer?: boolean;
  }): Promise<{ currentMetricValue: number; unlockedAchievements: string[] }> {
    const {
      userId,
      metricKey,
      incrementBy,
      value,
      flagValue,
      useBuffer = false,
    } = args;

    if (useBuffer) {
      if (incrementBy !== undefined) {
        await this.bufferService.bufferIncrement(
          userId,
          metricKey,
          incrementBy,
        );
      } else if (value !== undefined) {
        await this.bufferService.bufferPeak(userId, metricKey, value);
      } else if (flagValue !== undefined) {
        await this.bufferService.bufferFlag(userId, metricKey, flagValue);
      }
      return { currentMetricValue: 0, unlockedAchievements: [] };
    }

    // Direct synchronous ingestion
    const metrics = await this.getOrCreateUserMetrics(userId);
    let currentVal = 0;

    if (metricKey === 'matches_played') {
      metrics.matchesPlayed =
        Number(metrics.matchesPlayed || 0) + (incrementBy ?? 1);
      currentVal = metrics.matchesPlayed;
    } else if (metricKey === 'goals_scored') {
      metrics.goalsScored =
        Number(metrics.goalsScored || 0) + (incrementBy ?? 1);
      currentVal = metrics.goalsScored;
    } else if (metricKey === 'mvp_matches_count') {
      metrics.mvpMatchesCount =
        Number(metrics.mvpMatchesCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.mvpMatchesCount;
    } else if (metricKey === 'streak_days') {
      metrics.streakDays =
        value ?? Number(metrics.streakDays || 0) + (incrementBy ?? 1);
      currentVal = metrics.streakDays;
    } else if (metricKey === 'match_win_streak') {
      metrics.matchWinStreak =
        value ?? Number(metrics.matchWinStreak || 0) + (incrementBy ?? 1);
      currentVal = metrics.matchWinStreak;
    } else if (metricKey === 'flickshorts_uploaded_count') {
      metrics.flickshortsUploadedCount =
        Number(metrics.flickshortsUploadedCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.flickshortsUploadedCount;
    } else if (metricKey === 'peak_likes_single_short') {
      metrics.peakLikesSingleShort = Math.max(
        Number(metrics.peakLikesSingleShort || 0),
        value ?? 0,
      );
      currentVal = metrics.peakLikesSingleShort;
    } else if (metricKey === 'peak_shares_single_short') {
      metrics.peakSharesSingleShort = Math.max(
        Number(metrics.peakSharesSingleShort || 0),
        value ?? 0,
      );
      currentVal = metrics.peakSharesSingleShort;
    } else if (metricKey === 'peak_views_single_short') {
      metrics.peakViewsSingleShort = Math.max(
        Number(metrics.peakViewsSingleShort || 0),
        value ?? 0,
      );
      currentVal = metrics.peakViewsSingleShort;
    } else if (metricKey === 'teammates_connected_count') {
      metrics.teammatesConnectedCount =
        value ??
        Number(metrics.teammatesConnectedCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.teammatesConnectedCount;
    } else if (metricKey === 'referrals_completed_count') {
      metrics.referralsCompletedCount =
        Number(metrics.referralsCompletedCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.referralsCompletedCount;
    } else if (metricKey === 'messages_sent_count') {
      metrics.messagesSentCount =
        Number(metrics.messagesSentCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.messagesSentCount;
    } else if (metricKey === 'matches_recorded_count') {
      metrics.matchesRecordedCount =
        Number(metrics.matchesRecordedCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.matchesRecordedCount;
    } else if (metricKey === 'highlights_created_count') {
      metrics.highlightsCreatedCount =
        Number(metrics.highlightsCreatedCount || 0) + (incrementBy ?? 1);
      currentVal = metrics.highlightsCreatedCount;
    } else if (flagValue !== undefined) {
      if (metricKey === 'beta_tester_flag') metrics.betaTesterFlag = flagValue;
      if (metricKey === 'lifetime_legend_flag')
        metrics.lifetimeLegendFlag = flagValue;
      if (metricKey === 'fast_start_flag') metrics.fastStartFlag = flagValue;
      if (metricKey === 'exceptional_competitive_flag')
        metrics.exceptionalCompetitiveFlag = flagValue;
      if (metricKey === 'standout_content_flag')
        metrics.standoutContentFlag = flagValue;
      if (metricKey === 'community_notable_flag')
        metrics.communityNotableFlag = flagValue;
      if (metricKey === 'sustained_activity_flag')
        metrics.sustainedActivityFlag = flagValue;
      if (metricKey === 'community_icon_flag')
        metrics.communityIconFlag = flagValue;
      if (metricKey === 'legacy_contribution_flag')
        metrics.legacyContributionFlag = flagValue;
      currentVal = flagValue ? 1 : 0;
    }

    await this.metricsRepo.save(metrics);

    const totals = await this.pointsService.getMyTotals(userId);
    const evalResult = await this.evaluationService.evaluateUser(userId, {
      userLevel: totals.level,
      metrics,
    });

    return {
      currentMetricValue: currentVal,
      unlockedAchievements: evalResult.newlyUnlockedIds,
    };
  }
}
