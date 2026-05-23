import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecordingHighlightEngagements1762300000000 implements MigrationInterface {
  name = 'RecordingHighlightEngagements1762300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD COLUMN IF NOT EXISTS "likes_count" integer NOT NULL DEFAULT 0`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recording_highlight_engagements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "recording_highlight_id" uuid NOT NULL,
        "liked" boolean NOT NULL DEFAULT false,
        "saved" boolean NOT NULL DEFAULT false,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recording_highlight_engagements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_highlight_engagement_user_highlight" UNIQUE ("user_id", "recording_highlight_id"),
        CONSTRAINT "FK_rhe_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rhe_highlight" FOREIGN KEY ("recording_highlight_id") REFERENCES "recording_highlights"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rhe_highlight_id" ON "recording_highlight_engagements" ("recording_highlight_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_rhe_user_saved" ON "recording_highlight_engagements" ("user_id", "saved")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rhe_user_saved"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rhe_highlight_id"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "recording_highlight_engagements"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN IF EXISTS "likes_count"`,
    );
  }
}
