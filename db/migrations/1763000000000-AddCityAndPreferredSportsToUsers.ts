import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCityAndPreferredSportsToUsers1763000000000 implements MigrationInterface {
  name = 'AddCityAndPreferredSportsToUsers1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "city" character varying(100),
        ADD COLUMN IF NOT EXISTS "preferred_sports" jsonb DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "preferred_sports",
        DROP COLUMN IF EXISTS "city"
    `);
  }
}
