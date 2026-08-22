import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHalfHourlyPricingRates1763300000000 implements MigrationInterface {
  name = 'AddHalfHourlyPricingRates1763300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pricing_configs"
        ADD COLUMN IF NOT EXISTS "cricket_half_hourly_rate" numeric(10,2) NOT NULL DEFAULT 150,
        ADD COLUMN IF NOT EXISTS "pickleball_half_hourly_rate" numeric(10,2) NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "padel_half_hourly_rate" numeric(10,2) NOT NULL DEFAULT 125,
        ADD COLUMN IF NOT EXISTS "default_half_hourly_rate" numeric(10,2) NOT NULL DEFAULT 125
    `);

    await queryRunner.query(`
      UPDATE "pricing_configs"
      SET
        "cricket_half_hourly_rate" = ROUND("cricket_hourly_rate" / 2, 2),
        "pickleball_half_hourly_rate" = ROUND("pickleball_hourly_rate" / 2, 2),
        "padel_half_hourly_rate" = ROUND("padel_hourly_rate" / 2, 2),
        "default_half_hourly_rate" = ROUND("default_hourly_rate" / 2, 2)
      WHERE "id" = 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pricing_configs"
        DROP COLUMN IF EXISTS "cricket_half_hourly_rate",
        DROP COLUMN IF EXISTS "pickleball_half_hourly_rate",
        DROP COLUMN IF EXISTS "padel_half_hourly_rate",
        DROP COLUMN IF EXISTS "default_half_hourly_rate"
    `);
  }
}
