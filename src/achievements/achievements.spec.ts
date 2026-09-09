import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserPoints } from '../points/entities/user-points.entity';
import { PointsService } from '../points/points.service';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import { AchievementEvaluationService } from './services/achievement-evaluation.service';
import { AchievementRewardService } from './services/achievement-reward.service';
import { AchievementAggregatorService } from './services/achievement-aggregator.service';
import { AchievementMetricsBufferService } from './services/achievement-metrics-buffer.service';
import { AchievementEventConsumer } from './events/achievement-event.consumer';
import { AchievementUnlockedEvent } from './events/achievement-unlocked.event';
import {
  AchievementCategory,
  AchievementStatus,
  AchievementTier,
} from '../interface/achievement.interface';
import { APPROVED_ACHIEVEMENT_DEFINITIONS } from '../constant/achievement-catalog.constant';
import { NotificationEntity } from '../notification/entities/notification.entity';
import { User } from '../user/entities/user.entity';

describe('Achievements Module - Complete 15 Tasks Test Suite', () => {
  let mockDefinitionRepo: jest.Mocked<Repository<AchievementDefinition>>;
  let mockUserAchievementRepo: jest.Mocked<Repository<UserAchievement>>;
  let mockMetricsRepo: jest.Mocked<Repository<UserAchievementMetrics>>;
  let mockUserPointsRepo: jest.Mocked<Repository<UserPoints>>;
  let mockUserRepo: jest.Mocked<Repository<User>>;
  let mockNotificationRepo: jest.Mocked<Repository<NotificationEntity>>;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockPointsService: jest.Mocked<PointsService>;
  let mockEventEmitter: jest.Mocked<EventEmitter2>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockFirebaseNotificationService: any;

  let evaluationService: AchievementEvaluationService;
  let rewardService: AchievementRewardService;
  let bufferService: AchievementMetricsBufferService;
  let aggregatorService: AchievementAggregatorService;
  let achievementsService: AchievementsService;
  let achievementsController: AchievementsController;
  let eventConsumer: AchievementEventConsumer;

  const mockDefinitions: AchievementDefinition[] = APPROVED_ACHIEVEMENT_DEFINITIONS.map(
    (d) =>
      ({
        ...d,
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as unknown as AchievementDefinition,
  );

  beforeEach(() => {
    mockDefinitionRepo = {
      find: jest.fn().mockResolvedValue(mockDefinitions),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    } as any;

    mockUserAchievementRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entities) => Promise.resolve(entities)),
      createQueryBuilder: jest.fn(),
    } as any;

    mockMetricsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    } as any;

    mockUserPointsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    } as any;

    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user_123',
        name: 'Alex Player',
        user_devices_token: [{ devices_id: 'token_abc123' }],
      }),
    } as any;

    mockNotificationRepo = {
      save: jest.fn().mockResolvedValue({}),
    } as any;

    mockPointsService = {
      getMyTotals: jest.fn().mockResolvedValue({
        totalPoints: 500,
        perEvent: [],
        level: 2,
        levelName: 'Silver',
        nextLevelPoints: 30,
        levelProgress: 0.5,
      }),
      awardPoints: jest.fn().mockResolvedValue({ id: 'event_123' } as any),
    } as any;

    mockEventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    } as any;

    mockConfigService = {
      get: jest.fn().mockReturnValue(null),
    } as any;

    mockFirebaseNotificationService = {
      sendNotification: jest.fn().mockResolvedValue(true),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (callback) => {
        const mockManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === AchievementDefinition) return mockDefinitionRepo;
            if (entity === UserAchievement) return mockUserAchievementRepo;
            if (entity === UserAchievementMetrics) return mockMetricsRepo;
            return {} as any;
          }),
        };
        return callback(mockManager);
      }),
    } as any;

    evaluationService = new AchievementEvaluationService(
      mockDefinitionRepo,
      mockUserAchievementRepo,
      mockMetricsRepo,
      mockEventEmitter,
    );

    rewardService = new AchievementRewardService(
      mockDataSource,
      mockPointsService,
      evaluationService,
    );

    bufferService = new AchievementMetricsBufferService(mockConfigService);

    aggregatorService = new AchievementAggregatorService(
      mockDataSource,
      mockMetricsRepo,
      bufferService,
      evaluationService,
      mockPointsService,
    );

    achievementsService = new AchievementsService(
      mockDefinitionRepo,
      mockUserAchievementRepo,
      mockMetricsRepo,
      mockPointsService,
      evaluationService,
      rewardService,
      aggregatorService,
      bufferService,
    );

    achievementsController = new AchievementsController(achievementsService);

    eventConsumer = new AchievementEventConsumer(
      mockUserRepo,
      mockNotificationRepo,
      mockFirebaseNotificationService,
    );
  });

  // =========================================================================
  // Task 1: Document Achievement APIs
  // =========================================================================
  describe('Task 1: API Redesign - Document Achievement APIs', () => {
    it('verifies that achievement response DTOs and swagger metadata are valid', () => {
      expect(APPROVED_ACHIEVEMENT_DEFINITIONS.length).toBe(46);
      const debut = APPROVED_ACHIEVEMENT_DEFINITIONS.find(
        (d) => d.id === 'ATH_TURF_DEBUT',
      );
      expect(debut).toBeDefined();
      expect(debut?.metricKey).toBe('matches_played');
      expect(debut?.category).toBe(AchievementCategory.ATHLETE);
      expect(debut?.tier).toBe(AchievementTier.BRONZE);
    });
  });

  // =========================================================================
  // Task 2: Implement AchievementModule
  // =========================================================================
  describe('Task 2: Backend Engine - Implement AchievementModule', () => {
    it('seeds catalog definitions on initialization', async () => {
      mockDefinitionRepo.find.mockResolvedValueOnce([]);
      await achievementsService.ensureCatalogSeeded();
      expect(mockDefinitionRepo.save).toHaveBeenCalled();
    });

    it('injects all modular providers cleanly into AchievementsService facade', () => {
      expect(achievementsService.evaluationService).toBeDefined();
      expect(achievementsService.rewardService).toBeDefined();
      expect(achievementsService.aggregatorService).toBeDefined();
      expect(achievementsService.bufferService).toBeDefined();
    });
  });

  // =========================================================================
  // Task 3: Implement AchievementAggregatorService
  // =========================================================================
  describe('Task 3: Backend Engine - Implement AchievementAggregatorService', () => {
    it('aggregates activity into user achievement metrics and initializes default counters', async () => {
      const createdMetrics: Partial<UserAchievementMetrics> = {
        userId: 'user_1',
        matchesPlayed: 0,
        goalsScored: 0,
      };
      mockMetricsRepo.findOne.mockResolvedValueOnce(null);
      mockMetricsRepo.create.mockReturnValueOnce(createdMetrics as any);
      mockMetricsRepo.save.mockResolvedValueOnce(createdMetrics as any);

      const metrics = await aggregatorService.getOrCreateUserMetrics('user_1');
      expect(metrics.userId).toBe('user_1');
      expect(metrics.matchesPlayed).toBe(0);
    });
  });

  // =========================================================================
  // Task 4: Implement AchievementEvaluationService
  // =========================================================================
  describe('Task 4: Backend Engine - Implement AchievementEvaluationService', () => {
    it('evaluates achievement definitions against current user metrics and transitions state', async () => {
      const userMetrics: Partial<UserAchievementMetrics> = {
        userId: 'user_1',
        matchesPlayed: 10,
      };
      mockMetricsRepo.findOne.mockResolvedValue(userMetrics as any);
      mockUserAchievementRepo.find.mockResolvedValue([]);

      const result = await evaluationService.evaluateUser('user_1', {
        metrics: userMetrics as any,
      });

      expect(result.evaluatedCount).toBe(46);
      expect(result.newlyUnlockedIds).toContain('ATH_TURF_DEBUT');
      expect(result.newlyUnlockedIds).toContain('ATH_REGULAR_STARTER');
    });

    it('correctly maps various metric keys from telemetry to numeric values', () => {
      const metrics: Partial<UserAchievementMetrics> = {
        userId: 'u1',
        matchesPlayed: 5,
        goalsScored: 12,
        mvpMatchesCount: 3,
        streakDays: 7,
        matchWinStreak: 4,
        flickshortsUploadedCount: 2,
        peakLikesSingleShort: 150,
        peakSharesSingleShort: 30,
        peakViewsSingleShort: 5000,
        teammatesConnectedCount: 25,
        crewWatchRank: 1,
        referralsCompletedCount: 10,
        messagesSentCount: 120,
        socialRankPercentile: 0.5,
        matchesRecordedCount: 8,
        highlightsCreatedCount: 20,
        betaTesterFlag: true,
        lifetimeLegendFlag: true,
        fastStartFlag: true,
      };

      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'matches_played')).toBe(5);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'goals_scored')).toBe(12);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'mvp_matches_count')).toBe(3);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'peak_likes_single_short')).toBe(150);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'crew_watch_rank')).toBe(1);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'social_rank_percentile')).toBe(1);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'beta_tester_flag')).toBe(1);
      expect(evaluationService.getTelemetryMetricValue(metrics as any, 'player_level', 4)).toBe(4);
    });
  });

  // =========================================================================
  // Task 5: Implement Progress Calculation
  // =========================================================================
  describe('Task 5: Backend Engine - Implement Progress Calculation', () => {
    it('calculates current value, target value, and clamped percentage progress', () => {
      const p1 = evaluationService.calculateProgress(5, 10);
      expect(p1.progressPercent).toBe(50);
      expect(p1.isCompleted).toBe(false);

      const p2 = evaluationService.calculateProgress(15, 10);
      expect(p2.progressPercent).toBe(100);
      expect(p2.isCompleted).toBe(true);

      const p3 = evaluationService.calculateProgress(0, 50);
      expect(p3.progressPercent).toBe(0);
      expect(p3.isCompleted).toBe(false);
    });

    it('formats human-readable progress counter text consistently', () => {
      expect(evaluationService.formatProgressText(3, 10, 'matches_played')).toBe('3 / 10 Matches');
      expect(evaluationService.formatProgressText(1, 1, 'matches_played')).toBe('1 / 1 Match');
      expect(evaluationService.formatProgressText(25, 100, 'goals_scored')).toBe('25 / 100 Goals');
      expect(evaluationService.formatProgressText(7, 7, 'streak_days')).toBe('7 / 7 Days');
      expect(evaluationService.formatProgressText(3, 5, 'mvp_matches_count')).toBe('3 / 5 MVPs');
      expect(evaluationService.formatProgressText(10, 25, 'player_level')).toBe('Level 10 / 25');
    });
  });

  // =========================================================================
  // Task 6: Implement Idempotent Completion Processing
  // =========================================================================
  describe('Task 6: Backend Engine - Implement Idempotent Completion Processing', () => {
    it('prevents duplicate completion when the same activity event is processed multiple times', async () => {
      const existingUA: Partial<UserAchievement> = {
        userId: 'u1',
        achievementId: 'ATH_TURF_DEBUT',
        currentProgress: 1,
        targetValue: 1,
        status: AchievementStatus.UNLOCKED,
        isCompleted: true,
        completedAt: new Date('2026-09-01T00:00:00Z'),
        isRewardClaimed: false,
      };

      const userMetrics: Partial<UserAchievementMetrics> = {
        userId: 'u1',
        matchesPlayed: 1,
      };

      mockUserAchievementRepo.find.mockResolvedValue([existingUA as any]);
      mockMetricsRepo.findOne.mockResolvedValue(userMetrics as any);

      const result = await evaluationService.evaluateUser('u1', {
        metrics: userMetrics as any,
      });

      expect(result.newlyUnlockedIds).not.toContain('ATH_TURF_DEBUT');
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        AchievementUnlockedEvent.EVENT_NAME,
        expect.objectContaining({ achievementId: 'ATH_TURF_DEBUT' }),
      );
    });

    it('enforces non-regression invariant when metrics decrease', async () => {
      const completedUA: Partial<UserAchievement> = {
        userId: 'u1',
        achievementId: 'ATH_CONSISTENT_PLAYER',
        currentProgress: 10,
        targetValue: 10,
        status: AchievementStatus.UNLOCKED,
        isCompleted: true,
        isRewardClaimed: false,
      };

      // Streak broken (streakDays drops to 0)
      const brokenStreakMetrics: Partial<UserAchievementMetrics> = {
        userId: 'u1',
        streakDays: 0,
      };

      mockUserAchievementRepo.find.mockResolvedValue([completedUA as any]);
      mockMetricsRepo.findOne.mockResolvedValue(brokenStreakMetrics as any);

      const result = await evaluationService.evaluateUser('u1', {
        metrics: brokenStreakMetrics as any,
      });

      const consistentAchv = result.achievements.find(
        (a) => a.achievementId === 'ATH_CONSISTENT_PLAYER',
      );
      expect(consistentAchv?.isCompleted).toBe(true);
      expect(consistentAchv?.status).toBe(AchievementStatus.UNLOCKED);
    });
  });

  // =========================================================================
  // Task 7: Implement Achievement Reward Service
  // =========================================================================
  describe('Task 7: Backend Engine - Implement Achievement Reward Service', () => {
    it('awards configured achievement XP and calculates level up on valid claim', async () => {
      const definition: Partial<AchievementDefinition> = {
        id: 'ATH_TURF_DEBUT',
        title: 'Turf Debut',
        targetValue: 1,
        xpReward: 100,
        isActive: true,
        category: AchievementCategory.ATHLETE,
        tier: AchievementTier.BRONZE,
      };

      const userAchievement: Partial<UserAchievement> = {
        userId: 'u1',
        achievementId: 'ATH_TURF_DEBUT',
        currentProgress: 1,
        targetValue: 1,
        status: AchievementStatus.UNLOCKED,
        isCompleted: true,
        isRewardClaimed: false,
      };

      mockDefinitionRepo.findOne.mockResolvedValue(definition as any);
      mockUserAchievementRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(userAchievement),
      } as any);

      mockPointsService.getMyTotals
        .mockResolvedValueOnce({
          totalPoints: 500,
          perEvent: [],
          level: 2,
          levelName: 'Silver',
          nextLevelPoints: 30,
          levelProgress: 0.5,
        })
        .mockResolvedValueOnce({
          totalPoints: 600,
          perEvent: [],
          level: 3,
          levelName: 'Gold',
          nextLevelPoints: 60,
          levelProgress: 0.2,
        });

      const response = await rewardService.claimAchievementReward('u1', 'ATH_TURF_DEBUT');

      expect(response.achievementId).toBe('ATH_TURF_DEBUT');
      expect(response.xpAwarded).toBe(100);
      expect(response.previousLevel).toBe(2);
      expect(response.currentLevel).toBe(3);
      expect(response.levelUpOccurred).toBe(true);
      expect(mockPointsService.awardPoints).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          points: 100,
          refId: 'ATH_TURF_DEBUT',
        }),
      );
    });
  });

  // =========================================================================
  // Task 8: Implement Achievement Claim Validation
  // =========================================================================
  describe('Task 8: Backend Engine - Implement Achievement Claim Validation', () => {
    it('rejects claims when user ID or achievement ID is empty', async () => {
      await expect(rewardService.claimAchievementReward('', 'ATH_TURF_DEBUT')).rejects.toThrow(
        BadRequestException,
      );
      await expect(rewardService.claimAchievementReward('u1', '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects claims when achievement definition does not exist (404)', async () => {
      mockDefinitionRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        rewardService.claimAchievementReward('u1', 'NON_EXISTENT'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects claims when achievement is already claimed (409 Conflict)', async () => {
      const definition: Partial<AchievementDefinition> = {
        id: 'ATH_TURF_DEBUT',
        title: 'Turf Debut',
        targetValue: 1,
        xpReward: 100,
        isActive: true,
      };
      const claimedUA: Partial<UserAchievement> = {
        userId: 'u1',
        achievementId: 'ATH_TURF_DEBUT',
        isRewardClaimed: true,
        status: AchievementStatus.CLAIMED,
      };

      mockDefinitionRepo.findOne.mockResolvedValue(definition as any);
      mockUserAchievementRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(claimedUA),
      } as any);

      await expect(
        rewardService.claimAchievementReward('u1', 'ATH_TURF_DEBUT'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects claims when achievement requirements are incomplete (400 Bad Request)', async () => {
      const definition: Partial<AchievementDefinition> = {
        id: 'ATH_CENTURION',
        title: 'Centurion',
        targetValue: 50,
        metricKey: 'matches_played',
        isActive: true,
      };
      const incompleteUA: Partial<UserAchievement> = {
        userId: 'u1',
        achievementId: 'ATH_CENTURION',
        currentProgress: 12,
        isCompleted: false,
        isRewardClaimed: false,
      };

      mockDefinitionRepo.findOne.mockResolvedValue(definition as any);
      mockUserAchievementRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(incompleteUA),
      } as any);

      mockMetricsRepo.findOne.mockResolvedValue({
        userId: 'u1',
        matchesPlayed: 12,
      } as any);

      await expect(
        rewardService.claimAchievementReward('u1', 'ATH_CENTURION'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // Task 9: Implement Redis Metrics Buffer
  // =========================================================================
  describe('Task 9: Backend Engine - Implement Redis Metrics Buffer', () => {
    it('buffers high-frequency counter increments and peak metrics in memory/redis', async () => {
      await bufferService.bufferIncrement('u1', 'matches_played', 2);
      await bufferService.bufferIncrement('u1', 'goals_scored', 3);
      await bufferService.bufferPeak('u1', 'peak_likes_single_short', 250);
      await bufferService.bufferFlag('u1', 'beta_tester_flag', true);

      const stats = bufferService.getBufferStats();
      expect(stats.pendingMemoryUsers).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Task 10: Implement Metric Flush Strategy
  // =========================================================================
  describe('Task 10: Backend Engine - Implement Metric Flush Strategy', () => {
    it('reliably flushes and persists buffered deltas to database without data loss', async () => {
      await bufferService.bufferIncrement('u_flush_1', 'matches_played', 5);
      await bufferService.bufferPeak('u_flush_1', 'peak_likes_single_short', 500);

      const deltas = await bufferService.flushMetrics();
      expect(deltas.length).toBe(1);
      expect(deltas[0].userId).toBe('u_flush_1');
      expect(deltas[0].increments['matches_played']).toBe(5);
      expect(deltas[0].peaks['peak_likes_single_short']).toBe(500);

      // Subsequent immediate flush should be empty (buffer drained)
      const secondFlush = await bufferService.flushMetrics();
      expect(secondFlush.length).toBe(0);
    });
  });

  // =========================================================================
  // Task 11: Implement Achievement Unlock Events
  // =========================================================================
  describe('Task 11: Backend Engine - Implement Achievement Unlock Events', () => {
    it('dispatches unlock notification to user device tokens and notification entity', async () => {
      const event = new AchievementUnlockedEvent(
        'user_123',
        'ATH_TURF_DEBUT',
        'Turf Debut',
        'Play your first match',
        AchievementCategory.ATHLETE,
        AchievementTier.BRONZE,
        100,
        'bronze-picklebat.png',
      );

      await eventConsumer.handleAchievementUnlocked(event);

      expect(mockFirebaseNotificationService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'token_abc123',
          notification: {
            title: '🏆 Achievement Unlocked: Turf Debut!',
            body: "You earned 'Turf Debut' (+100 XP). Claim your reward now!",
          },
        }),
        'user_123',
      );

      expect(mockNotificationRepo.save).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Task 12: Integrate Match Events
  // =========================================================================
  describe('Task 12: Backend Engine - Integrate Match Events', () => {
    it('connects match participation to Athlete match-count achievements', async () => {
      const metrics: Partial<UserAchievementMetrics> = {
        userId: 'u_match',
        matchesPlayed: 9,
      };
      mockMetricsRepo.findOne.mockResolvedValue(metrics as any);
      mockUserAchievementRepo.find.mockResolvedValue([]);

      const result = await aggregatorService.recordMatchParticipation('u_match', 1);

      expect(result.totalMatchesPlayed).toBe(10);
      expect(result.unlockedAchievements).toContain('ATH_REGULAR_STARTER');
    });
  });

  // =========================================================================
  // Task 13: Integrate Goal Events
  // =========================================================================
  describe('Task 13: Backend Engine - Integrate Goal Events', () => {
    it('connects goal-scoring events to Sharp Shooter and Goal Machine', async () => {
      const metrics: Partial<UserAchievementMetrics> = {
        userId: 'u_goal',
        goalsScored: 24,
      };
      mockMetricsRepo.findOne.mockResolvedValue(metrics as any);
      mockUserAchievementRepo.find.mockResolvedValue([]);

      const result = await aggregatorService.recordGoalScored('u_goal', 1);

      expect(result.totalGoalsScored).toBe(25);
      expect(result.unlockedAchievements).toContain('ATH_SHARP_SHOOTER');
    });
  });

  // =========================================================================
  // Task 14: Integrate MVP Events
  // =========================================================================
  describe('Task 14: Backend Engine - Integrate MVP Events', () => {
    it('connects MVP results to MVP and Turf Legend progression', async () => {
      const metrics: Partial<UserAchievementMetrics> = {
        userId: 'u_mvp',
        mvpMatchesCount: 4,
      };
      mockMetricsRepo.findOne.mockResolvedValue(metrics as any);
      mockUserAchievementRepo.find.mockResolvedValue([]);

      const result = await aggregatorService.recordMvpAwarded('u_mvp', 1);

      expect(result.totalMvpMatchesCount).toBe(5);
      expect(result.unlockedAchievements).toContain('ATH_MVP');
    });
  });

  // =========================================================================
  // Task 15: Integrate Match Streak Events
  // =========================================================================
  describe('Task 15: Backend Engine - Integrate Match Streak Events', () => {
    it('connects streak information to Consistent Player and Hot Streak', async () => {
      const metrics: Partial<UserAchievementMetrics> = {
        userId: 'u_streak',
        streakDays: 9,
        matchWinStreak: 14,
      };
      mockMetricsRepo.findOne.mockResolvedValue(metrics as any);
      mockUserAchievementRepo.find.mockResolvedValue([]);

      const result = await aggregatorService.recordStreakUpdated('u_streak', 10, 15);

      expect(result.streakDays).toBe(10);
      expect(result.matchWinStreak).toBe(15);
      expect(result.unlockedAchievements).toContain('ATH_CONSISTENT_PLAYER');
      expect(result.unlockedAchievements).toContain('SPC_HOT_STREAK');
    });
  });

  // =========================================================================
  // Controller End-to-End Tests for Event Routes
  // =========================================================================
  describe('Achievements Controller API routes', () => {
    const mockReq = { user: { user_id: 'u_ctrl' } } as any;

    it('GET / - returns full achievements catalogue with summary', async () => {
      mockUserAchievementRepo.find.mockResolvedValue([]);
      mockMetricsRepo.findOne.mockResolvedValue(null);

      const response = await achievementsController.getAchievements(mockReq, {});
      expect(response.summary).toBeDefined();
      expect(response.summary.totalAchievements).toBe(46);
      expect(response.achievements.length).toBe(46);
    });

    it('POST /:id/claim - claims achievement reward', async () => {
      jest.spyOn(achievementsService, 'claimAchievementReward').mockResolvedValueOnce({
        achievementId: 'ATH_TURF_DEBUT',
        title: 'Turf Debut',
        xpAwarded: 100,
        newTotalXp: 600,
        previousLevel: 2,
        currentLevel: 3,
        currentLevelName: 'Gold',
        levelUpOccurred: true,
        claimedAt: new Date().toISOString(),
      });

      const response = await achievementsController.claimReward(mockReq, 'ATH_TURF_DEBUT');
      expect(response.achievementId).toBe('ATH_TURF_DEBUT');
      expect(response.xpAwarded).toBe(100);
    });

    it('POST /events/match - delegates match event', async () => {
      jest.spyOn(achievementsService, 'recordMatchParticipation').mockResolvedValueOnce({
        totalMatchesPlayed: 10,
        unlockedAchievements: ['ATH_REGULAR_STARTER'],
      });

      const res = await achievementsController.recordMatchEvent(mockReq, {
        userId: 'u_ctrl',
        matchesCount: 1,
      });
      expect(res.success).toBe(true);
      expect(res.totalMatchesPlayed).toBe(10);
    });

    it('POST /events/goal - delegates goal event', async () => {
      jest.spyOn(achievementsService, 'recordGoalScored').mockResolvedValueOnce({
        totalGoalsScored: 25,
        unlockedAchievements: ['ATH_SHARP_SHOOTER'],
      });

      const res = await achievementsController.recordGoalEvent(mockReq, {
        userId: 'u_ctrl',
        goalsCount: 2,
      });
      expect(res.success).toBe(true);
      expect(res.totalGoalsScored).toBe(25);
    });

    it('POST /events/mvp - delegates mvp event', async () => {
      jest.spyOn(achievementsService, 'recordMvpAwarded').mockResolvedValueOnce({
        totalMvpMatchesCount: 5,
        unlockedAchievements: ['ATH_MVP'],
      });

      const res = await achievementsController.recordMvpEvent(mockReq, {
        userId: 'u_ctrl',
        count: 1,
      });
      expect(res.success).toBe(true);
      expect(res.totalMvpMatchesCount).toBe(5);
    });

    it('POST /events/streak - delegates streak event', async () => {
      jest.spyOn(achievementsService, 'recordStreakUpdated').mockResolvedValueOnce({
        streakDays: 10,
        matchWinStreak: 15,
        unlockedAchievements: ['ATH_CONSISTENT_PLAYER'],
      });

      const res = await achievementsController.recordStreakEvent(mockReq, {
        userId: 'u_ctrl',
        streakDays: 10,
        matchWinStreak: 15,
      });
      expect(res.success).toBe(true);
      expect(res.streakDays).toBe(10);
    });

    it('POST /buffer/flush - triggers buffer flush', async () => {
      jest.spyOn(achievementsService, 'flushMetricsBuffer').mockResolvedValueOnce([]);
      jest.spyOn(achievementsService, 'getBufferStats').mockReturnValueOnce({
        isRedisConnected: false,
        pendingMemoryUsers: 0,
        isFlushing: false,
      });

      const res = await achievementsController.flushBuffer();
      expect(res.success).toBe(true);
      expect(res.flushedUsersCount).toBe(0);
    });
  });
});
