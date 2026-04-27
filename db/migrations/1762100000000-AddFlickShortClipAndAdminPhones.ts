import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFlickShortClipAndAdminPhones1762100000000 implements MigrationInterface {
  name = 'AddFlickShortClipAndAdminPhones1762100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      ADD COLUMN IF NOT EXISTS "start_sec" double precision NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      ADD COLUMN IF NOT EXISTS "end_sec" double precision NOT NULL DEFAULT 15
    `);
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      DROP CONSTRAINT IF EXISTS "flick_shorts_clip_ok"
    `);
    await queryRunner.query(`
      ALTER TABLE "flick_shorts"
      ADD CONSTRAINT "flick_shorts_clip_ok" CHECK (
        "end_sec" > "start_sec"
        AND ("end_sec" - "start_sec") <= 15
        AND "start_sec" >= 0
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_phones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "phone_last_10" character varying(10) NOT NULL,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_phones" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admin_phones_last10" UNIQUE ("phone_last_10"),
        CONSTRAINT "FK_admin_phones_user" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "admin_phones" ("phone_last_10")
      VALUES ('9321538768')
      ON CONFLICT ("phone_last_10") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_phones"`);
    await queryRunner.query(
      `ALTER TABLE "flick_shorts" DROP CONSTRAINT IF EXISTS "flick_shorts_clip_ok"`,
    );
    await queryRunner.query(
      `ALTER TABLE "flick_shorts" DROP COLUMN IF EXISTS "end_sec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "flick_shorts" DROP COLUMN IF EXISTS "start_sec"`,
    );
  }
}
