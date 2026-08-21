import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCameraPiColumns1763200000000 implements MigrationInterface {
  name = 'AddCameraPiColumns1763200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "raspberryPiBaseUrl" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "raspberryPiApiKey" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "court_number" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN IF EXISTS "court_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN IF EXISTS "raspberryPiApiKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN IF EXISTS "raspberryPiBaseUrl"`,
    );
  }
}
