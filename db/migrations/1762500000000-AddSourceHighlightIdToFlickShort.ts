import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `source_highlight_id` to `flick_shorts` so the user-side "Submit to
 * FlickShorts" flow can dedupe per highlight:
 *
 *   - First submission of a highlight inserts a row with this column set.
 *   - Subsequent submission attempts for the same highlight are rejected
 *     while a row with that `source_highlight_id` exists.
 *   - Admin "rejects" by `DELETE`-ing the pending row, which frees the
 *     highlight for resubmission.
 *
 * Backfill is a no-op — existing rows came from admin Studio (no highlight
 * association) and stay NULL.
 */
export class AddSourceHighlightIdToFlickShort1762500000000 implements MigrationInterface {
  name = 'AddSourceHighlightIdToFlickShort1762500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      ADD COLUMN IF NOT EXISTS "source_highlight_id" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_flick_shorts_source_highlight" ON "flick_shorts" ("source_highlight_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_flick_shorts_source_highlight"`,
    );
    await queryRunner.query(
      `ALTER TABLE "flick_shorts" DROP COLUMN IF EXISTS "source_highlight_id"`,
    );
  }
}
