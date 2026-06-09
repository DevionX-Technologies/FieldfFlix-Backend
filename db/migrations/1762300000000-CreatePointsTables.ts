import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 of the gamification system.
 *
 * Creates three tables:
 *   point_events  — append-only audit log of every points award.
 *                   Idempotency-keyed so a replayed webhook never double-credits.
 *   user_points   — denormalized totals, one row per user, for snappy reads
 *                   on profile pages and the all-time leaderboard.
 *   point_configs — admin-editable point values per event type (5 default rows
 *                   are inserted by PointsService.ensureDefaults at boot).
 *
 * No data is migrated because no points have been awarded yet.
 */
export class CreatePointsTables1762300000000 implements MigrationInterface {
  name = 'CreatePointsTables1762300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Shared enum for point_events.eventType and point_configs.eventType.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."point_event_type_enum" AS ENUM (
          'recording_create',
          'recording_share',
          'recording_receive',
          'payment_complete',
          'flickshort_approved'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // point_events: append-only audit log.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "point_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "eventType" "public"."point_event_type_enum" NOT NULL,
        "refId" varchar(200),
        "idempotencyKey" varchar(250) NOT NULL,
        "points" integer NOT NULL,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_point_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_point_events_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_point_events_idempotency" ON "point_events" ("idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_point_events_user_created" ON "point_events" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_point_events_type_created" ON "point_events" ("eventType", "createdAt")`,
    );

    // user_points: denormalized totals cache.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_points" (
        "userId" uuid NOT NULL,
        "totalPoints" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_points" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_user_points_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_points_total" ON "user_points" ("totalPoints")`,
    );

    // point_configs: admin-editable per-event value. PK is the enum value itself.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "point_configs" (
        "eventType" "public"."point_event_type_enum" NOT NULL,
        "points" integer NOT NULL,
        "label" varchar(100) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_point_configs" PRIMARY KEY ("eventType")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "point_configs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_points_total"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_points"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_point_events_type_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_point_events_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_point_events_idempotency"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "point_events"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."point_event_type_enum"`,
    );
  }
}
