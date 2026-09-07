import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryRunner, Repository, DataSource } from 'typeorm';
import { CreateAchievementsModuleTables1763600000000 } from '../../db/migrations/1763600000000-CreateAchievementsModuleTables';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { UserPoints } from '../points/entities/user-points.entity';
import { PointsService } from '../points/points.service';
import { PointEventType } from '../points/entities/point-event.entity';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import {
  AchievementCategory,
  AchievementStatus,
  AchievementTier,
} from '../interface/achievement.interface';
import { APPROVED_ACHIEVEMENT_DEFINITIONS } from '../constant/achievement-catalog.constant';

describe('Achievements Module - Tasks 7 to 20 Tests', () => {
  describe('Task 7: State Machine Invariants & Edge Cases', () => {
    interface AchievementStateContext {
      currentProgress: number;
      targetValue: number;
      status: AchievementStatus;
      isCompleted: boolean;
      isRewardClaimed: boolean;
    }

    function evaluateProgress(
      ctx: AchievementStateContext,
      newTelemetryValue: number,
    ): AchievementStateContext {
      // Metric Reversal Safeguard (Invariant 5.1):
      // Once UNLOCKED or CLAIMED, the achievement cannot regress to IN_PROGRESS or LOCKED
      if (ctx.isCompleted) {
        return ctx;
      }

      const progress = Math.max(ctx.currentProgress, newTelemetryValue);
      const isMet = progress >= ctx.targetValue;

      let nextStatus: AchievementStatus = ctx.status;
      if (isMet) {
        nextStatus = AchievementStatus.UNLOCKED;
      } else if (progress > 0) {
        nextStatus = AchievementStatus.IN_PROGRESS;
      } else {
        nextStatus = AchievementStatus.LOCKED;
      }

      return {
        ...ctx,
        currentProgress: progress,
        status: nextStatus,
        isCompleted: isMet,
      };
    }

    function claimReward(ctx: AchievementStateContext): {
      updatedCtx: AchievementStateContext;
      xpAwarded: number;
    } {
      if (!ctx.isCompleted) {
        throw new Error('Cannot claim incomplete achievement');
      }
      if (ctx.isRewardClaimed) {
        throw new Error('Reward already claimed');
      }

      return {
        updatedCtx: {
          ...ctx,
          isRewardClaimed: true,
          status: AchievementStatus.CLAIMED,
        },
        xpAwarded: 100,
      };
    }

    it('T1 -> T2: Transitions from LOCKED to IN_PROGRESS when progress is made', () => {
      const initial: AchievementStateContext = {
        currentProgress: 0,
        targetValue: 10,
        status: AchievementStatus.LOCKED,
        isCompleted: false,
        isRewardClaimed: false,
      };

      const afterOne = evaluateProgress(initial, 1);
      expect(afterOne.status).toBe(AchievementStatus.IN_PROGRESS);
      expect(afterOne.currentProgress).toBe(1);
      expect(afterOne.isCompleted).toBe(false);
    });

    it('T2 -> T4: Transitions from IN_PROGRESS to UNLOCKED when target reached', () => {
      const inProgress: AchievementStateContext = {
        currentProgress: 5,
        targetValue: 10,
        status: AchievementStatus.IN_PROGRESS,
        isCompleted: false,
        isRewardClaimed: false,
      };

      const reached = evaluateProgress(inProgress, 10);
      expect(reached.status).toBe(AchievementStatus.UNLOCKED);
      expect(reached.isCompleted).toBe(true);
      expect(reached.currentProgress).toBe(10);
    });

    it('T1 -> T4: Single event can transition directly from LOCKED to UNLOCKED', () => {
      const initial: AchievementStateContext = {
        currentProgress: 0,
        targetValue: 1,
        status: AchievementStatus.LOCKED,
        isCompleted: false,
        isRewardClaimed: false,
      };

      const reached = evaluateProgress(initial, 1);
      expect(reached.status).toBe(AchievementStatus.UNLOCKED);
      expect(reached.isCompleted).toBe(true);
    });

    it('T4 -> T5: Allows claiming UNLOCKED achievement, moving to CLAIMED', () => {
      const unlocked: AchievementStateContext = {
        currentProgress: 10,
        targetValue: 10,
        status: AchievementStatus.UNLOCKED,
        isCompleted: true,
        isRewardClaimed: false,
      };

      const { updatedCtx, xpAwarded } = claimReward(unlocked);
      expect(updatedCtx.status).toBe(AchievementStatus.CLAIMED);
      expect(updatedCtx.isRewardClaimed).toBe(true);
      expect(xpAwarded).toBe(100);
    });

    it('Invariant 5.1: Metric reversals do not regress UNLOCKED or CLAIMED achievements', () => {
      const completed: AchievementStateContext = {
        currentProgress: 10,
        targetValue: 10,
        status: AchievementStatus.UNLOCKED,
        isCompleted: true,
        isRewardClaimed: false,
      };

      // Streak drops to 0 or shorts deleted
      const reverted = evaluateProgress(completed, 0);
      expect(reverted.status).toBe(AchievementStatus.UNLOCKED);
      expect(reverted.isCompleted).toBe(true);
      expect(reverted.currentProgress).toBe(10);
    });

    it('Invariant 5.3: Claiming is idempotent and rejects duplicate claims', () => {
      const claimed: AchievementStateContext = {
        currentProgress: 10,
        targetValue: 10,
        status: AchievementStatus.CLAIMED,
        isCompleted: true,
        isRewardClaimed: true,
      };

      expect(() => claimReward(claimed)).toThrow('Reward already claimed');
    });

    it('Invariant 5.2: Clamps progress percentage calculation to 100%', () => {
      const targetValue = 50;
      const currentProgress = 65;
      const progressPercent = Math.min(
        100,
        Math.floor((currentProgress / targetValue) * 100),
      );
      expect(progressPercent).toBe(100);
    });
  });

  describe('Task 8, 9, 10: Entity Definitions & Defaults', () => {
    it('instantiates AchievementDefinition with valid attributes', () => {
      const def = new AchievementDefinition();
      def.id = 'ATH_TURF_DEBUT';
      def.category = AchievementCategory.ATHLETE;
      def.tier = AchievementTier.BRONZE;
      def.title = 'Turf Debut';
      def.description = 'Play your first match';
      def.requirementText = 'Play 1 Match';
      def.metricKey = 'matches_played';
      def.targetValue = 1;
      def.xpReward = 100;
      def.badgeAssetKey = 'bronze-picklebat.png';
      def.displayOrder = 1;
      def.isActive = true;

      expect(def.id).toBe('ATH_TURF_DEBUT');
      expect(def.category).toBe(AchievementCategory.ATHLETE);
      expect(def.tier).toBe(AchievementTier.BRONZE);
      expect(def.targetValue).toBe(1);
    });

    it('instantiates UserAchievementMetrics with athlete, creator, and social telemetry', () => {
      const metrics = new UserAchievementMetrics();
      metrics.userId = '00000000-0000-0000-0000-000000000001';
      metrics.matchesPlayed = 5;
      metrics.goalsScored = 12;
      metrics.mvpMatchesCount = 2;
      metrics.streakDays = 3;
      metrics.flickshortsUploadedCount = 4;
      metrics.peakLikesSingleShort = 150;
      metrics.peakSharesSingleShort = 10;
      metrics.peakViewsSingleShort = 1200;
      metrics.teammatesConnectedCount = 8;
      metrics.crewWatchRank = 1;
      metrics.socialRankPercentile = 95.5;

      expect(metrics.matchesPlayed).toBe(5);
      expect(metrics.goalsScored).toBe(12);
      expect(metrics.flickshortsUploadedCount).toBe(4);
      expect(metrics.socialRankPercentile).toBe(95.5);
    });

    it('instantiates UserAchievement with status and claim state', () => {
      const ua = new UserAchievement();
      ua.userId = '00000000-0000-0000-0000-000000000001';
      ua.achievementId = 'ATH_TURF_DEBUT';
      ua.currentProgress = 1;
      ua.targetValue = 1;
      ua.status = AchievementStatus.UNLOCKED;
      ua.isCompleted = true;
      ua.isRewardClaimed = false;

      expect(ua.status).toBe(AchievementStatus.UNLOCKED);
      expect(ua.isCompleted).toBe(true);
      expect(ua.isRewardClaimed).toBe(false);
    });
  });

  describe('Task 8 to 12: Migration Execution & Seed Catalogue Verification', () => {
    let migration: CreateAchievementsModuleTables1763600000000;
    let queriesExecuted: string[];
    let mockQueryRunner: Partial<QueryRunner>;

    beforeEach(() => {
      migration = new CreateAchievementsModuleTables1763600000000();
      queriesExecuted = [];
      mockQueryRunner = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          queriesExecuted.push(sql);
          return [];
        }),
      };
    });

    it('migration.up executes all DDL and seeding statements', async () => {
      await migration.up(mockQueryRunner as QueryRunner);

      // Verify UUID extension
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'),
        ),
      ).toBe(true);

      // Verify Enums created
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE TYPE "public"."achievement_category_enum"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE TYPE "public"."achievement_tier_enum"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE TYPE "public"."achievement_status_enum"'),
        ),
      ).toBe(true);

      // Verify Table 1: achievement_definitions (Task 8)
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE TABLE IF NOT EXISTS "achievement_definitions"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('IDX_achievements_metric'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('IDX_achievements_category_order'),
        ),
      ).toBe(true);

      // Verify Table 2: user_achievement_metrics (Task 9)
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE TABLE IF NOT EXISTS "user_achievement_metrics"'),
        ),
      ).toBe(true);

      // Verify Table 3: user_achievements (Task 10)
      expect(
        queriesExecuted.some((q) =>
          q.includes('CREATE TABLE IF NOT EXISTS "user_achievements"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('UQ_user_achievement_user_definition'),
        ),
      ).toBe(true);

      // Verify Task 11: 8 Athlete Badges seeded
      const athleteSeedQuery = queriesExecuted.find(
        (q) =>
          q.includes('ATH_TURF_DEBUT') &&
          q.includes('ATH_TURF_LEGEND'),
      );
      expect(athleteSeedQuery).toBeDefined();
      expect(athleteSeedQuery).toContain('ATH_TURF_DEBUT');
      expect(athleteSeedQuery).toContain('ATH_REGULAR_STARTER');
      expect(athleteSeedQuery).toContain('ATH_CENTURION');
      expect(athleteSeedQuery).toContain('ATH_SHARP_SHOOTER');
      expect(athleteSeedQuery).toContain('ATH_GOAL_MACHINE');
      expect(athleteSeedQuery).toContain('ATH_CONSISTENT_PLAYER');
      expect(athleteSeedQuery).toContain('ATH_MVP');
      expect(athleteSeedQuery).toContain('ATH_TURF_LEGEND');

      // Verify Task 12: 8 Creator Badges seeded
      const creatorSeedQuery = queriesExecuted.find(
        (q) =>
          q.includes('CRE_FIRST_REEL') &&
          q.includes('CRE_REEL_LEGEND'),
      );
      expect(creatorSeedQuery).toBeDefined();
      expect(creatorSeedQuery).toContain('CRE_FIRST_REEL');
      expect(creatorSeedQuery).toContain('CRE_HIGHLIGHT_REEL');
      expect(creatorSeedQuery).toContain('CRE_CONTENT_MACHINE');
      expect(creatorSeedQuery).toContain('CRE_CROWD_PLEASER');
      expect(creatorSeedQuery).toContain('CRE_VIRAL_SENSATION');
      expect(creatorSeedQuery).toContain('CRE_TRENDING_CLIP');
      expect(creatorSeedQuery).toContain('CRE_SHARE_MAGNET');
      expect(creatorSeedQuery).toContain('CRE_REEL_LEGEND');
    });

    it('migration.down drops all tables and enums in reverse order', async () => {
      await migration.down(mockQueryRunner as QueryRunner);

      expect(
        queriesExecuted.some((q) =>
          q.includes('DROP TABLE IF EXISTS "user_achievements"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('DROP TABLE IF EXISTS "user_achievement_metrics"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('DROP TABLE IF EXISTS "achievement_definitions"'),
        ),
      ).toBe(true);
      expect(
        queriesExecuted.some((q) =>
          q.includes('DROP TYPE IF EXISTS "public"."achievement_status_enum"'),
        ),
      ).toBe(true);
    });
  });

  describe('Task 17 & 18: Redesign GET Achievements API & Response DTO Normalization', () => {
    let service: AchievementsService;
    let mockDefinitionRepo: Partial<Repository<AchievementDefinition>>;
    let mockUserAchievementRepo: Partial<Repository<UserAchievement>>;
    let mockMetricsRepo: Partial<Repository<UserAchievementMetrics>>;
    let mockUserPointsRepo: Partial<Repository<UserPoints>>;
    let mockPointsService: Partial<PointsService>;
    let mockDataSource: Partial<DataSource>;

    const mockDefinitions: AchievementDefinition[] = APPROVED_ACHIEVEMENT_DEFINITIONS.map(
      (d) =>
        ({
          ...d,
          createdAt: new Date(),
          updatedAt: new Date(),
          userAchievements: [],
        }) as AchievementDefinition,
    );

    beforeEach(() => {
      mockDefinitionRepo = {
        find: jest.fn().mockResolvedValue(mockDefinitions),
        create: jest.fn().mockImplementation((data) => data),
        save: jest.fn().mockImplementation((data) => data),
      };

      mockUserAchievementRepo = {
        find: jest.fn().mockResolvedValue([
          {
            userId: 'user-1',
            achievementId: 'ATH_TURF_DEBUT',
            currentProgress: 1,
            targetValue: 1,
            status: AchievementStatus.UNLOCKED,
            isCompleted: true,
            completedAt: new Date('2026-09-01T10:00:00Z'),
            isRewardClaimed: false,
            claimedAt: null,
          } as UserAchievement,
          {
            userId: 'user-1',
            achievementId: 'ATH_REGULAR_STARTER',
            currentProgress: 4,
            targetValue: 10,
            status: AchievementStatus.IN_PROGRESS,
            isCompleted: false,
            completedAt: null,
            isRewardClaimed: false,
            claimedAt: null,
          } as UserAchievement,
        ]),
      };

      mockMetricsRepo = {
        findOne: jest.fn().mockResolvedValue({
          userId: 'user-1',
          matchesPlayed: 4,
          goalsScored: 0,
          flickshortsUploadedCount: 0,
          peakLikesSingleShort: 0,
          streakDays: 0,
          mvpMatchesCount: 0,
          teammatesConnectedCount: 0,
          crewWatchRank: 999,
          referralsCompletedCount: 0,
          messagesSentCount: 0,
          socialRankPercentile: 100.0,
          matchesRecordedCount: 0,
          highlightsCreatedCount: 0,
        } as UserAchievementMetrics),
      };

      mockUserPointsRepo = {
        findOne: jest.fn().mockResolvedValue({
          userId: 'user-1',
          totalPoints: 100,
        } as UserPoints),
      };

      mockPointsService = {
        getMyTotals: jest.fn().mockResolvedValue({
          totalPoints: 100,
          perEvent: [],
          level: 2,
          levelName: 'Silver',
          nextLevelPoints: 30,
          levelProgress: 0.5,
        }),
        calculateLevel: jest.fn().mockResolvedValue({
          level: 2,
          levelName: 'Silver',
          nextLevelPoints: 30,
          levelProgress: 0.5,
        }),
      };

      mockDataSource = {
        transaction: jest.fn(),
      };

      service = new AchievementsService(
        mockDataSource as DataSource,
        mockDefinitionRepo as Repository<AchievementDefinition>,
        mockUserAchievementRepo as Repository<UserAchievement>,
        mockMetricsRepo as Repository<UserAchievementMetrics>,
        mockUserPointsRepo as Repository<UserPoints>,
        mockPointsService as PointsService,
      );
    });

    it('returns unified response with summary statistics and achievements list', async () => {
      const response = await service.getAchievements('user-1');

      expect(response).toBeDefined();
      expect(response.summary).toBeDefined();
      expect(response.achievements).toBeDefined();
      expect(response.summary.totalAchievements).toBe(46);
      expect(response.summary.currentLevel).toBe(2);
      expect(response.summary.currentLevelName).toBe('Silver');
      expect(response.summary.unlockedCount).toBe(2); // ATH_TURF_DEBUT and LVL_ROOKIE (level 2 >= 1)
      expect(response.summary.unclaimedRewardsCount).toBe(2);
      expect(response.summary.inProgressCount).toBe(7); // 2 match milestones + 5 level milestones
      expect(response.summary.lockedCount).toBe(37);
      expect(response.achievements.length).toBe(46);
    });

    it('normalizes progress percentage clamped between 0 and 100', async () => {
      const response = await service.getAchievements('user-1');

      const debut = response.achievements.find(
        (a) => a.id === 'ATH_TURF_DEBUT',
      );
      expect(debut).toBeDefined();
      expect(debut?.progressPercent).toBe(100);
      expect(debut?.status).toBe(AchievementStatus.UNLOCKED);
      expect(debut?.rewardValue).toBe('+100 XP');
      expect(debut?.progressText).toBe('1 / 1 Match');

      const starter = response.achievements.find(
        (a) => a.id === 'ATH_REGULAR_STARTER',
      );
      expect(starter).toBeDefined();
      expect(starter?.progressPercent).toBe(40);
      expect(starter?.status).toBe(AchievementStatus.IN_PROGRESS);
      expect(starter?.progressText).toBe('4 / 10 Matches');
      expect(starter?.rewardValue).toBe('+300 XP');
    });

    it('filters achievements by category (ATHLETE)', async () => {
      const response = await service.getAchievements('user-1', {
        category: AchievementCategory.ATHLETE,
      });

      expect(response.achievements.length).toBe(8);
      expect(
        response.achievements.every(
          (a) => a.category === AchievementCategory.ATHLETE,
        ),
      ).toBe(true);
      // Summary still reflects full catalogue
      expect(response.summary.totalAchievements).toBe(46);
    });

    it('filters achievements by status (UNLOCKED)', async () => {
      const response = await service.getAchievements('user-1', {
        status: AchievementStatus.UNLOCKED,
      });

      expect(response.achievements.length).toBe(2);
      expect(response.achievements.map((a) => a.id)).toContain(
        'ATH_TURF_DEBUT',
      );
      expect(response.achievements.map((a) => a.id)).toContain(
        'LVL_ROOKIE',
      );
    });

    it('formats progressText correctly across diverse metric keys', () => {
      expect(service.formatProgressText(1, 1, 'matches_played')).toBe(
        '1 / 1 Match',
      );
      expect(service.formatProgressText(15, 50, 'matches_played')).toBe(
        '15 / 50 Matches',
      );
      expect(service.formatProgressText(25, 100, 'goals_scored')).toBe(
        '25 / 100 Goals',
      );
      expect(service.formatProgressText(7, 10, 'streak_days')).toBe(
        '7 / 10 Days',
      );
      expect(service.formatProgressText(1, 5, 'mvp_matches_count')).toBe(
        '1 / 5 MVPs',
      );
      expect(service.formatProgressText(10, 50, 'flickshorts_uploaded_count')).toBe(
        '10 / 50 Shorts',
      );
      expect(service.formatProgressText(200, 1000, 'peak_likes_single_short')).toBe(
        '200 / 1000 Likes',
      );
      expect(service.formatProgressText(5, 20, 'teammates_connected_count')).toBe(
        '5 / 20 Teammates',
      );
      expect(service.formatProgressText(3, 10, 'referrals_completed_count')).toBe(
        '3 / 10 Friends',
      );
      expect(service.formatProgressText(10, 25, 'player_level')).toBe(
        'Level 10 / 25',
      );
    });
  });

  describe('Task 19 & 20: Redesign Achievement Reward Claim API & Error Handling', () => {
    let service: AchievementsService;
    let mockDefinitionRepo: Partial<Repository<AchievementDefinition>>;
    let mockUserAchievementRepo: Partial<Repository<UserAchievement>>;
    let mockMetricsRepo: Partial<Repository<UserAchievementMetrics>>;
    let mockUserPointsRepo: Partial<Repository<UserPoints>>;
    let mockPointsService: Partial<PointsService>;
    let mockDataSource: Partial<DataSource>;

    beforeEach(() => {
      mockPointsService = {
        getMyTotals: jest
          .fn()
          .mockResolvedValueOnce({
            totalPoints: 100,
            level: 2,
            levelName: 'Silver',
          })
          .mockResolvedValueOnce({
            totalPoints: 200,
            level: 3,
            levelName: 'Gold',
          }),
        awardPoints: jest.fn().mockResolvedValue({
          id: 'point-event-1',
          points: 100,
          eventType: PointEventType.ACHIEVEMENT_CLAIM,
        }),
      };

      mockDataSource = {
        transaction: jest.fn().mockImplementation(async (callback) => {
          const mockQueryBuilder = {
            setLock: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue({
              id: 'ua-1',
              userId: 'user-1',
              achievementId: 'ATH_TURF_DEBUT',
              currentProgress: 1,
              targetValue: 1,
              status: AchievementStatus.UNLOCKED,
              isCompleted: true,
              completedAt: new Date('2026-09-01T10:00:00Z'),
              isRewardClaimed: false,
              claimedAt: null,
            } as UserAchievement),
          };

          const mockManager = {
            getRepository: jest.fn().mockImplementation((entity) => {
              if (entity === AchievementDefinition) {
                return {
                  findOne: jest.fn().mockResolvedValue({
                    id: 'ATH_TURF_DEBUT',
                    title: 'Turf Debut',
                    category: AchievementCategory.ATHLETE,
                    tier: AchievementTier.BRONZE,
                    targetValue: 1,
                    xpReward: 100,
                    metricKey: 'matches_played',
                  } as AchievementDefinition),
                };
              }
              if (entity === UserAchievement) {
                return {
                  createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
                  save: jest.fn().mockImplementation((ua) => ua),
                  create: jest.fn().mockImplementation((ua) => ua),
                };
              }
              if (entity === UserAchievementMetrics) {
                return {
                  findOne: jest.fn().mockResolvedValue({
                    userId: 'user-1',
                    matchesPlayed: 1,
                  }),
                };
              }
              return {};
            }),
          };
          return callback(mockManager);
        }),
      };

      service = new AchievementsService(
        mockDataSource as DataSource,
        mockDefinitionRepo as Repository<AchievementDefinition>,
        mockUserAchievementRepo as Repository<UserAchievement>,
        mockMetricsRepo as Repository<UserAchievementMetrics>,
        mockUserPointsRepo as Repository<UserPoints>,
        mockPointsService as PointsService,
      );
    });

    it('claims completed achievement, awards XP, and returns level progression', async () => {
      const claimResult = await service.claimAchievementReward(
        'user-1',
        'ATH_TURF_DEBUT',
      );

      expect(claimResult).toBeDefined();
      expect(claimResult.achievementId).toBe('ATH_TURF_DEBUT');
      expect(claimResult.title).toBe('Turf Debut');
      expect(claimResult.xpAwarded).toBe(100);
      expect(claimResult.newTotalXp).toBe(200);
      expect(claimResult.previousLevel).toBe(2);
      expect(claimResult.currentLevel).toBe(3);
      expect(claimResult.levelUpOccurred).toBe(true);
      expect(claimResult.claimedAt).toBeDefined();

      expect(mockPointsService.awardPoints).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          eventType: PointEventType.ACHIEVEMENT_CLAIM,
          refId: 'ATH_TURF_DEBUT',
          points: 100,
        }),
      );
    });

    it('Task 20: throws NotFoundException (404) when achievement does not exist', async () => {
      mockDataSource.transaction = jest.fn().mockImplementation(async (cb) => {
        const mockManager = {
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null), // definition not found
          }),
        };
        return cb(mockManager);
      });

      await expect(
        service.claimAchievementReward('user-1', 'INVALID_ACHIEVEMENT_ID'),
      ).rejects.toThrow(NotFoundException);
    });

    it('Task 20: throws ConflictException (409) when achievement reward is already claimed', async () => {
      mockDataSource.transaction = jest.fn().mockImplementation(async (cb) => {
        const mockManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === AchievementDefinition) {
              return {
                findOne: jest.fn().mockResolvedValue({
                  id: 'ATH_TURF_DEBUT',
                  title: 'Turf Debut',
                }),
              };
            }
            if (entity === UserAchievement) {
              return {
                createQueryBuilder: jest.fn().mockReturnValue({
                  setLock: jest.fn().mockReturnThis(),
                  where: jest.fn().mockReturnThis(),
                  getOne: jest.fn().mockResolvedValue({
                    id: 'ua-1',
                    isRewardClaimed: true,
                    status: AchievementStatus.CLAIMED,
                  }),
                }),
              };
            }
            return {};
          }),
        };
        return cb(mockManager);
      });

      await expect(
        service.claimAchievementReward('user-1', 'ATH_TURF_DEBUT'),
      ).rejects.toThrow(ConflictException);
    });

    it('Task 20: throws BadRequestException (400) when achievement requirements are incomplete', async () => {
      mockDataSource.transaction = jest.fn().mockImplementation(async (cb) => {
        const mockManager = {
          getRepository: jest.fn().mockImplementation((entity) => {
            if (entity === AchievementDefinition) {
              return {
                findOne: jest.fn().mockResolvedValue({
                  id: 'ATH_CENTURION',
                  title: 'Centurion',
                  targetValue: 50,
                  metricKey: 'matches_played',
                }),
              };
            }
            if (entity === UserAchievement) {
              return {
                createQueryBuilder: jest.fn().mockReturnValue({
                  setLock: jest.fn().mockReturnThis(),
                  where: jest.fn().mockReturnThis(),
                  getOne: jest.fn().mockResolvedValue({
                    id: 'ua-1',
                    currentProgress: 12,
                    targetValue: 50,
                    isCompleted: false,
                    isRewardClaimed: false,
                    status: AchievementStatus.IN_PROGRESS,
                  }),
                }),
              };
            }
            if (entity === UserAchievementMetrics) {
              return {
                findOne: jest.fn().mockResolvedValue({
                  userId: 'user-1',
                  matchesPlayed: 12,
                }),
              };
            }
            return {};
          }),
        };
        return cb(mockManager);
      });

      await expect(
        service.claimAchievementReward('user-1', 'ATH_CENTURION'),
      ).rejects.toThrow(BadRequestException);
    });

    it('controller delegates GET / and POST /:id/claim calls to service', async () => {
      const mockService = {
        getAchievements: jest.fn().mockResolvedValue({ summary: {}, achievements: [] }),
        claimAchievementReward: jest.fn().mockResolvedValue({ achievementId: 'ATH_TURF_DEBUT' }),
      } as unknown as AchievementsService;

      const controller = new AchievementsController(mockService);
      const req = { user: { user_id: 'user-1' } } as any;

      await controller.getAchievements(req, { category: AchievementCategory.ATHLETE });
      expect(mockService.getAchievements).toHaveBeenCalledWith('user-1', {
        category: AchievementCategory.ATHLETE,
      });

      await controller.claimReward(req, 'ATH_TURF_DEBUT');
      expect(mockService.claimAchievementReward).toHaveBeenCalledWith(
        'user-1',
        'ATH_TURF_DEBUT',
      );
    });
  });
});
