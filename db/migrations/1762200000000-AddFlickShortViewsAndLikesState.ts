import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFlickShortViewsAndLikesState1762200000000
  implements MigrationInterface
{
  name = 'AddFlickShortViewsAndLikesState1762200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      ADD COLUMN IF NOT EXISTS "views_count" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      ADD COLUMN IF NOT EXISTS "liked_user_ids" jsonb NOT NULL DEFAULT '[]'
    `);
    await queryRunner.query(`
      UPDATE "flick_shorts"
      SET "liked_user_ids" = '[]'
      WHERE "liked_user_ids" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "flick_shorts"
      SET "likes_count" = jsonb_array_length("liked_user_ids")
      WHERE "liked_user_ids" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      DROP COLUMN IF EXISTS "liked_user_ids"
    `);
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      DROP COLUMN IF EXISTS "views_count"
    `);
  }
}
