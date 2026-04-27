import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFlickShortsTable1762000000000 implements MigrationInterface {
  name = 'CreateFlickShortsTable1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "flick_shorts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recording_id" uuid NOT NULL,
        "sport" character varying(32) NOT NULL,
        "title" character varying(255) NOT NULL DEFAULT '',
        "top_text" text NOT NULL DEFAULT '',
        "bottom_text" text NOT NULL DEFAULT '',
        "aspect" character varying(8) NOT NULL,
        "mux_playback_id" character varying(128) NOT NULL,
        "approved" boolean NOT NULL DEFAULT false,
        "likes_count" integer NOT NULL DEFAULT 0,
        "created_by_user_id" uuid,
        "comments" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_flick_shorts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_flick_shorts_recording" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_flick_shorts_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_flick_shorts_sport_approved" ON "flick_shorts" ("sport", "approved")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "flick_shorts"`);
  }
}
