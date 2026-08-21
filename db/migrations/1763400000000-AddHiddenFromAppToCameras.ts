import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHiddenFromAppToCameras1763400000000 implements MigrationInterface {
  name = 'AddHiddenFromAppToCameras1763400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "hidden_from_app" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN IF EXISTS "hidden_from_app"`,
    );
  }
}
