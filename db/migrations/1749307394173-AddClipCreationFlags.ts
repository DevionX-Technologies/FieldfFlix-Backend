import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add flags for preventing duplicate clip/video creation in Mux.
 *
 * - isVideoCreated: Flag on recordings table to track if main video asset is created
 * - isClipCreated: Flag on recording_highlights table to track if clip asset is created
 *
 * These flags prevent duplicate creation of assets in Mux when webhooks are received
 * multiple times or when retry mechanisms process the same highlight.
 *
 * NOTE: Timestamp bumped from 1736290000000 -> 1749307394173 so this runs AFTER the
 * base-schema migration (1748699507845, creates `recordings`/`recording_highlights`)
 * and the Mux migration (1749307394172, adds `mux_asset_id`/`asset_id`). The original
 * timestamp caused this ALTER to run before those tables/columns existed, breaking any
 * build from an empty database. ADD COLUMN uses IF NOT EXISTS so re-running on a database
 * that already applied the old-numbered version is a no-op.
 */
export class AddClipCreationFlags1749307394173 implements MigrationInterface {
  name = 'AddClipCreationFlags1749307394173';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add isVideoCreated flag to recordings table
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "isVideoCreated" boolean NOT NULL DEFAULT false`,
    );

    // Add isClipCreated flag to recording_highlights table
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "isClipCreated" boolean NOT NULL DEFAULT false`,
    );

    // Add retryCount column to recording_highlights table
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "retryCount" integer NOT NULL DEFAULT 0`,
    );

    // Update existing records: Set isVideoCreated = true for recordings that already have mux_asset_id
    await queryRunner.query(
      `UPDATE "recordings" SET "isVideoCreated" = true WHERE "mux_asset_id" IS NOT NULL`,
    );

    // Update existing records: Set isClipCreated = true for highlights that already have asset_id
    await queryRunner.query(
      `UPDATE "recording_highlights" SET "isClipCreated" = true WHERE "asset_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN "retryCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN "isClipCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "isVideoCreated"`,
    );
  }
}
