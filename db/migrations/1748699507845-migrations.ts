import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1748699507845 implements MigrationInterface {
  name = 'Migrations1748699507845';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cameras" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "turfId" uuid NOT NULL, CONSTRAINT "PK_88b40b9817f9f422121f861e1e8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "recordings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "cameraId" uuid NOT NULL, "startTime" TIMESTAMP NOT NULL DEFAULT now(), "endTime" TIMESTAMP, "s3Path" character varying, "raspberryPiRecordingId" character varying, "status" character varying NOT NULL DEFAULT 'in_progress', "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "metadata" jsonb, "is_favorite" boolean NOT NULL DEFAULT false, "share_token" uuid, CONSTRAINT "UQ_4de6faf8f5dc3777c91127e0847" UNIQUE ("share_token"), CONSTRAINT "PK_8c3247d5ee4551d59bb2115a484" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."ESurfaceType" RENAME TO "ESurfaceType_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ESurfaceType" AS ENUM('artificial_Grass')`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "surface_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "surface_type" TYPE "public"."ESurfaceType"[] USING "surface_type"::"text"::"public"."ESurfaceType"[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "surface_type" SET DEFAULT '{artificial_Grass}'`,
    );
    await queryRunner.query(`DROP TYPE "public"."ESurfaceType_old"`);
    await queryRunner.query(
      `ALTER TYPE "public"."ESportsSupported" RENAME TO "ESportsSupported_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ESportsSupported" AS ENUM('Football', 'Cricket', 'Hockey', 'Rugby', 'Tennis', 'Pickleball')`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "sports_supported" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "sports_supported" TYPE "public"."ESportsSupported"[] USING "sports_supported"::"text"::"public"."ESportsSupported"[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "sports_supported" SET DEFAULT '{Football}'`,
    );
    await queryRunner.query(`DROP TYPE "public"."ESportsSupported_old"`);
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD CONSTRAINT "FK_7c83affd6ab277842be21606662" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
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
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP CONSTRAINT "FK_7c83affd6ab277842be21606662"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ESportsSupported_old" AS ENUM('Football', 'Cricket', 'Hockey', 'Rugby', 'Tennis')`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "sports_supported" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "sports_supported" TYPE "public"."ESportsSupported_old"[] USING "sports_supported"::"text"::"public"."ESportsSupported_old"[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "sports_supported" SET DEFAULT '{Football}'`,
    );
    await queryRunner.query(`DROP TYPE "public"."ESportsSupported"`);
    await queryRunner.query(
      `ALTER TYPE "public"."ESportsSupported_old" RENAME TO "ESportsSupported"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ESurfaceType_old" AS ENUM('artificial_Grass', 'natural_Grass', 'hybrid')`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "surface_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "surface_type" TYPE "public"."ESurfaceType_old"[] USING "surface_type"::"text"::"public"."ESurfaceType_old"[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "turfs" ALTER COLUMN "surface_type" SET DEFAULT '{artificial_Grass}'`,
    );
    await queryRunner.query(`DROP TYPE "public"."ESurfaceType"`);
    await queryRunner.query(
      `ALTER TYPE "public"."ESurfaceType_old" RENAME TO "ESurfaceType"`,
    );
    await queryRunner.query(`DROP TABLE "recordings"`);
    await queryRunner.query(`DROP TABLE "cameras"`);
  }
}
