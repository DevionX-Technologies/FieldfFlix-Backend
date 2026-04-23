import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClipProcessingColumns1760000000001 implements MigrationInterface {
  name = 'AddClipProcessingColumns1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to recording_highlights
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "processing_order" INTEGER`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "rate_limit_retry_count" INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "sqs_message_id" VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "lock_version" INTEGER NOT NULL DEFAULT 0`,
    );

    // Backfill processing_order using ROW_NUMBER based on button_click_timestamp
    await queryRunner.query(`
      UPDATE recording_highlights rh
      SET processing_order = sub.row_num
      FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY recording_id
          ORDER BY button_click_timestamp ASC
        ) AS row_num
        FROM recording_highlights
      ) sub
      WHERE rh.id = sub.id
    `);

    // Create composite index for queue processing queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rh_recording_status_order"
      ON "recording_highlights" ("recording_id", "status", "processing_order")
    `);

    // Create partial index for retry Lambda queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rh_status_retry"
      ON "recording_highlights" ("status", "retryCount")
      WHERE status IN ('failed', 'rate_limited', 'processing')
    `);

    // Map legacy 'preparing' status:
    // preparing + no asset_id → pending
    // preparing + has asset_id → clip_created
    await queryRunner.query(`
      UPDATE recording_highlights
      SET status = 'pending'
      WHERE status = 'preparing' AND asset_id IS NULL
    `);
    await queryRunner.query(`
      UPDATE recording_highlights
      SET status = 'clip_created'
      WHERE status = 'preparing' AND asset_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse status mapping
    await queryRunner.query(`
      UPDATE recording_highlights
      SET status = 'preparing'
      WHERE status IN ('pending', 'clip_created')
    `);

    // Drop indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rh_status_retry"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rh_recording_status_order"`,
    );

    // Drop columns
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN IF EXISTS "lock_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN IF EXISTS "sqs_message_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN IF EXISTS "rate_limit_retry_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN IF EXISTS "processing_order"`,
    );
  }
}
