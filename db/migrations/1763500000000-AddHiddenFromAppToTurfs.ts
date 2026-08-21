import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHiddenFromAppToTurfs1763500000000 implements MigrationInterface {
  name = 'AddHiddenFromAppToTurfs1763500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "turfs" ADD COLUMN IF NOT EXISTS "hidden_from_app" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "turfs" DROP COLUMN IF EXISTS "hidden_from_app"`,
    );
  }
}
