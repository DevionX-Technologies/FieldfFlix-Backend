import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePricingConfigTable1787221643793 implements MigrationInterface {
  name = 'CreatePricingConfigTable1787221643793';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_1b0438c29a64e61a823cd62ac51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99947ce5bbb28e4ccbd5672e283"`,
    );
    await queryRunner.query(
      `CREATE TABLE "pricing_configs" ("id" character varying(50) NOT NULL DEFAULT 'default', "cricket_hourly_rate" numeric(10,2) NOT NULL DEFAULT '300', "pickleball_hourly_rate" numeric(10,2) NOT NULL DEFAULT '200', "padel_hourly_rate" numeric(10,2) NOT NULL DEFAULT '250', "default_hourly_rate" numeric(10,2) NOT NULL DEFAULT '250', "highlight_base_price" numeric(10,2) NOT NULL DEFAULT '100', "shorts_base_price" numeric(10,2) NOT NULL DEFAULT '50', "gst_rate" numeric(5,4) NOT NULL DEFAULT '0.18', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_68f45b3c5c0404cfa95eada68f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "recording_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD "recording_name" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_1b0438c29a64e61a823cd62ac51" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99947ce5bbb28e4ccbd5672e283" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99947ce5bbb28e4ccbd5672e283"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_1b0438c29a64e61a823cd62ac51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "recording_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD "recording_name" character varying(255)`,
    );
    await queryRunner.query(`DROP TABLE "pricing_configs"`);
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99947ce5bbb28e4ccbd5672e283" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_1b0438c29a64e61a823cd62ac51" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
