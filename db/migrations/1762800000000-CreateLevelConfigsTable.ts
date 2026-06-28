import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLevelConfigsTable1762800000000 implements MigrationInterface {
  name = 'CreateLevelConfigsTable1762800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "level_configs" (
        "level" integer NOT NULL,
        "minPoints" integer NOT NULL,
        "name" character varying(100),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_level_configs" PRIMARY KEY ("level")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_level_configs_minPoints" ON "level_configs" ("minPoints")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_level_configs_minPoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "level_configs"`);
  }
}
