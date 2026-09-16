import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingWatermarkColumns1787221643794 implements MigrationInterface {
  name = 'AddRecordingWatermarkColumns1787221643794';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recordings"
        ADD COLUMN IF NOT EXISTS "mux_watermark_media_path" character varying(255),
        ADD COLUMN IF NOT EXISTS "mux_watermark_media_bucket" character varying(255);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recordings"
        DROP COLUMN IF EXISTS "mux_watermark_media_bucket",
        DROP COLUMN IF EXISTS "mux_watermark_media_path";
    `);
  }
}
