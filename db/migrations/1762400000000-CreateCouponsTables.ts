import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 — coupons + discount layer.
 *
 * Four tables:
 *   coupons                 — templates created by admin
 *   coupon_assignments      — one row per (coupon, user) grant
 *   coupon_redemptions      — audit log of every successful redemption
 *   leaderboard_auto_rules  — "at period-close, top-N gets this coupon"
 */
export class CreateCouponsTables1762400000000 implements MigrationInterface {
  name = 'CreateCouponsTables1762400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" varchar(30) NOT NULL,
        "label" varchar(200) NOT NULL,
        "discountPercent" integer NOT NULL,
        "maxRecordings" integer NOT NULL DEFAULT 1,
        "startsAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupons" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coupons_code" ON "coupons" ("code")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupon_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "couponId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "source" varchar(30) NOT NULL DEFAULT 'manual',
        "remainingRecordings" integer NOT NULL,
        "note" varchar(250),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupon_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_coupon_assignments_coupon"
          FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_coupon_assignments_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coupon_assignments_user" ON "coupon_assignments" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coupon_assignments_coupon_user" ON "coupon_assignments" ("couponId", "userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "couponId" uuid NOT NULL,
        "assignmentId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "paymentId" uuid,
        "recordingId" uuid,
        "basePriceInr" integer NOT NULL,
        "discountedPriceInr" integer NOT NULL,
        "discountPercentApplied" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coupon_redemptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_coupon_redemptions_coupon"
          FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_coupon_redemptions_assignment"
          FOREIGN KEY ("assignmentId") REFERENCES "coupon_assignments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_coupon_redemptions_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coupon_redemptions_payment" ON "coupon_redemptions" ("paymentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coupon_redemptions_user" ON "coupon_redemptions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coupon_redemptions_coupon" ON "coupon_redemptions" ("couponId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leaderboard_auto_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "period" varchar(10) NOT NULL,
        "rank" integer NOT NULL,
        "couponId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leaderboard_auto_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lb_auto_rules_coupon"
          FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lb_auto_rules_period_rank" ON "leaderboard_auto_rules" ("period", "rank")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "leaderboard_auto_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon_redemptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupons"`);
  }
}
