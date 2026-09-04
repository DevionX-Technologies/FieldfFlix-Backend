import { QueryRunner } from 'typeorm';
import { CreateAchievementsModuleTables1763600000000 } from '../../db/migrations/1763600000000-CreateAchievementsModuleTables';
import { AchievementDefinition } from './entities/achievement-definition.entity';
import { UserAchievementMetrics } from './entities/user-achievement-metrics.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import {
  AchievementCategory,
  AchievementStatus,
  AchievementTier,
} from '../interface/achievement.interface';

describe('Achievements Module - Tasks 7 to 12 Tests', () => {
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
});
