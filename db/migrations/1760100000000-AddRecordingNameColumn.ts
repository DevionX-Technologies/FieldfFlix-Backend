import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordingNameColumn1760100000000 implements MigrationInterface {
  name = 'AddRecordingNameColumn1760100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "recording_name" VARCHAR(255) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN IF EXISTS "recording_name"`,
    );
  }
}
