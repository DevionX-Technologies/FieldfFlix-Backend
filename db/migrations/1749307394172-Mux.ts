import { MigrationInterface, QueryRunner } from 'typeorm';

export class Mux1749307394172 implements MigrationInterface {
  name = 'Mux1749307394172';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_uploads" ADD "mux_asset_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" ADD "mux_playback_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD "mux_asset_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD "mux_playback_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD "mux_media_url" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "mux_media_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "mux_playback_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "mux_asset_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" DROP COLUMN "mux_playback_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" DROP COLUMN "mux_asset_id"`,
    );
  }
}
