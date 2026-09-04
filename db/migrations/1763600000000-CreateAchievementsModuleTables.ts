import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAchievementsModuleTables1763600000000
  implements MigrationInterface
{
  name = 'CreateAchievementsModuleTables1763600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure uuid-ossp extension is enabled
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 2. Create Enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."achievement_category_enum" AS ENUM (
          'ATHLETE',
          'CREATOR',
          'SOCIAL',
          'SPECIAL',
          'LEVEL_TIER'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."achievement_tier_enum" AS ENUM (
          'BRONZE',
          'SILVER',
          'GOLD',
          'PLATINUM',
          'SPECIAL',
          'BASE',
          'GREEN',
          'CYAN',
          'AMETHYST',
          'AMBER',
          'PRESTIGE'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."achievement_status_enum" AS ENUM (
          'LOCKED',
          'IN_PROGRESS',
          'UNLOCKED',
          'CLAIMED'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 3. Task 8: Create achievement_definitions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "achievement_definitions" (
        "id" varchar(64) NOT NULL,
        "category" "public"."achievement_category_enum" NOT NULL,
        "tier" "public"."achievement_tier_enum" NOT NULL,
        "title" varchar(128) NOT NULL,
        "description" text NOT NULL,
        "requirementText" varchar(128) NOT NULL,
        "metricKey" varchar(64) NOT NULL,
        "targetValue" bigint NOT NULL,
        "xpReward" integer NOT NULL DEFAULT 100,
        "badgeAssetKey" varchar(128) NOT NULL,
        "displayOrder" integer NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_achievement_definitions" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_achievements_metric"
        ON "achievement_definitions" ("metricKey", "targetValue");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_achievements_category_order"
        ON "achievement_definitions" ("category", "displayOrder");
    `);

    // 4. Task 9: Create user_achievement_metrics table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_achievement_metrics" (
        "userId" uuid NOT NULL,
        -- Athlete Metrics
        "matchesPlayed" integer NOT NULL DEFAULT 0,
        "goalsScored" integer NOT NULL DEFAULT 0,
        "mvpMatchesCount" integer NOT NULL DEFAULT 0,
        "streakDays" integer NOT NULL DEFAULT 0,
        "matchWinStreak" integer NOT NULL DEFAULT 0,
        -- Creator Metrics
        "flickshortsUploadedCount" integer NOT NULL DEFAULT 0,
        "peakLikesSingleShort" integer NOT NULL DEFAULT 0,
        "peakSharesSingleShort" integer NOT NULL DEFAULT 0,
        "peakViewsSingleShort" bigint NOT NULL DEFAULT 0,
        -- Social Metrics
        "teammatesConnectedCount" integer NOT NULL DEFAULT 0,
        "crewWatchRank" integer NOT NULL DEFAULT 999,
        "referralsCompletedCount" integer NOT NULL DEFAULT 0,
        "messagesSentCount" integer NOT NULL DEFAULT 0,
        "socialRankPercentile" numeric(5,2) NOT NULL DEFAULT 100.00,
        -- Special & Platform Flags
        "matchesRecordedCount" integer NOT NULL DEFAULT 0,
        "highlightsCreatedCount" integer NOT NULL DEFAULT 0,
        "userSignupSequence" integer,
        "betaTesterFlag" boolean NOT NULL DEFAULT false,
        "lifetimeLegendFlag" boolean NOT NULL DEFAULT false,
        "fastStartFlag" boolean NOT NULL DEFAULT false,
        "exceptionalCompetitiveFlag" boolean NOT NULL DEFAULT false,
        "standoutContentFlag" boolean NOT NULL DEFAULT false,
        "communityNotableFlag" boolean NOT NULL DEFAULT false,
        "sustainedActivityFlag" boolean NOT NULL DEFAULT false,
        "communityIconFlag" boolean NOT NULL DEFAULT false,
        "legacyContributionFlag" boolean NOT NULL DEFAULT false,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_achievement_metrics" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_user_achievement_metrics_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    // 5. Task 10: Create user_achievements table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_achievements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "achievementId" varchar(64) NOT NULL,
        "currentProgress" bigint NOT NULL DEFAULT 0,
        "targetValue" bigint NOT NULL,
        "status" "public"."achievement_status_enum" NOT NULL DEFAULT 'LOCKED',
        "isCompleted" boolean NOT NULL DEFAULT false,
        "completedAt" TIMESTAMP,
        "isRewardClaimed" boolean NOT NULL DEFAULT false,
        "claimedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_achievements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_achievements_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_achievements_definition"
          FOREIGN KEY ("achievementId") REFERENCES "achievement_definitions"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_user_achievement_user_definition"
          UNIQUE ("userId", "achievementId")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_achievements_user_status"
        ON "user_achievements" ("userId", "status");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_achievements_user_claim"
        ON "user_achievements" ("userId", "isCompleted", "isRewardClaimed");
    `);

    // 6. Task 11: Seed Athlete Achievements (8 Badges)
    await queryRunner.query(`
      INSERT INTO "achievement_definitions"
        ("id", "category", "tier", "title", "description", "requirementText", "metricKey", "targetValue", "xpReward", "badgeAssetKey", "displayOrder", "isActive")
      VALUES
        ('ATH_TURF_DEBUT', 'ATHLETE', 'BRONZE', 'Turf Debut', 'Play and complete your first match on a FieldFlicks enabled turf.', 'Play 1 Match', 'matches_played', 1, 100, 'bronze-picklebat.png', 1, true),
        ('ATH_REGULAR_STARTER', 'ATHLETE', 'SILVER', 'Regular Starter', 'Consistency is key. Play 10 recorded matches.', 'Play 10 Matches', 'matches_played', 10, 300, 'silver-picklebat.png', 2, true),
        ('ATH_CENTURION', 'ATHLETE', 'GOLD', 'Centurion', 'Become a court veteran by recording 50 full matches.', 'Play 50 Matches', 'matches_played', 50, 1000, 'gold-picklebat.png', 3, true),
        ('ATH_SHARP_SHOOTER', 'ATHLETE', 'SILVER', 'Sharp Shooter', 'Score 25 verified goals across recorded sessions.', 'Score 25 Goals', 'goals_scored', 25, 350, 'silver-sharp.png', 4, true),
        ('ATH_GOAL_MACHINE', 'ATHLETE', 'GOLD', 'Goal Machine', 'Score 100 goals to cement your offensive mastery.', 'Score 100 Goals', 'goals_scored', 100, 1000, 'gold-sharp.png', 5, true),
        ('ATH_CONSISTENT_PLAYER', 'ATHLETE', 'SILVER', 'Consistent Player', 'Maintain an active daily gameplay or winning streak of 10 days.', '10 Day Streak', 'streak_days', 10, 400, 'silver-rank.png', 6, true),
        ('ATH_MVP', 'ATHLETE', 'GOLD', 'MVP', 'Awarded MVP in 5 competitive match recordings.', 'Win MVP in 5 Matches', 'mvp_matches_count', 5, 500, 'gold-trophy.png', 7, true),
        ('ATH_TURF_LEGEND', 'ATHLETE', 'PLATINUM', 'Turf Legend', 'Claim 25 MVP honors across all match formats.', 'Win MVP in 25 Matches', 'mvp_matches_count', 25, 2000, 'platinum-trophy.png', 8, true)
      ON CONFLICT ("id") DO UPDATE SET
        "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "requirementText" = EXCLUDED."requirementText",
        "targetValue" = EXCLUDED."targetValue",
        "xpReward" = EXCLUDED."xpReward",
        "badgeAssetKey" = EXCLUDED."badgeAssetKey",
        "displayOrder" = EXCLUDED."displayOrder";
    `);

    // 7. Task 12: Seed Creator Achievements (8 Badges)
    await queryRunner.query(`
      INSERT INTO "achievement_definitions"
        ("id", "category", "tier", "title", "description", "requirementText", "metricKey", "targetValue", "xpReward", "badgeAssetKey", "displayOrder", "isActive")
      VALUES
        ('CRE_FIRST_REEL', 'CREATOR', 'BRONZE', 'First Reel', 'Upload your first FlickShort highlight reel.', 'Upload 1 FlickShort', 'flickshorts_uploaded_count', 1, 100, 'bronze-reel-badge.png', 9, true),
        ('CRE_HIGHLIGHT_REEL', 'CREATOR', 'SILVER', 'Highlight Reel', 'Publish 10 captivating FlickShorts.', 'Upload 10 FlickShorts', 'flickshorts_uploaded_count', 10, 350, 'silver-reel-badge.png', 10, true),
        ('CRE_CONTENT_MACHINE', 'CREATOR', 'GOLD', 'Content Machine', 'Publish 50 FlickShorts to build your athletic portfolio.', 'Upload 50 FlickShorts', 'flickshorts_uploaded_count', 50, 1000, 'gold-reel-badge.png', 11, true),
        ('CRE_CROWD_PLEASER', 'CREATOR', 'SILVER', 'Crowd Pleaser', 'Receive 100 likes on a single published FlickShort.', '100 Likes on a Short', 'peak_likes_single_short', 100, 400, 'silver-like-badge.png', 12, true),
        ('CRE_VIRAL_SENSATION', 'CREATOR', 'GOLD', 'Viral Sensation', 'Hit 1,000 likes on a single highlight clip.', '1,000 Likes on a Short', 'peak_likes_single_short', 1000, 1200, 'gold-like-badge.png', 13, true),
        ('CRE_TRENDING_CLIP', 'CREATOR', 'SILVER', 'Trending Clip', 'Have a single FlickShort shared 25 times.', '25 Shares on a Short', 'peak_shares_single_short', 25, 450, 'silver-share-badge.png', 14, true),
        ('CRE_SHARE_MAGNET', 'CREATOR', 'GOLD', 'Share Magnet', 'Reach 250 shares on a single highlight clip.', '250 Shares on a Short', 'peak_shares_single_short', 250, 1200, 'gold-share-badge.png', 15, true),
        ('CRE_REEL_LEGEND', 'CREATOR', 'PLATINUM', 'Reel Legend', 'Amass 10,000+ views across your published FlickShorts.', '10K+ Views on Shorts', 'peak_views_single_short', 10000, 2500, 'platinum-reel-badge.png', 16, true)
      ON CONFLICT ("id") DO UPDATE SET
        "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "requirementText" = EXCLUDED."requirementText",
        "targetValue" = EXCLUDED."targetValue",
        "xpReward" = EXCLUDED."xpReward",
        "badgeAssetKey" = EXCLUDED."badgeAssetKey",
        "displayOrder" = EXCLUDED."displayOrder";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_achievements";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_achievement_metrics";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "achievement_definitions";`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."achievement_status_enum";`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."achievement_tier_enum";`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."achievement_category_enum";`,
    );
  }
}
