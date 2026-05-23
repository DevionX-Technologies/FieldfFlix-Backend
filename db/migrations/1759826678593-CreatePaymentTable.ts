import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentTable1759826678593 implements MigrationInterface {
  name = 'CreatePaymentTable1759826678593';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_devices_token" DROP CONSTRAINT "user_devices_token_user_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP CONSTRAINT "fk_recording"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "fk_camera_turf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "notification_user_id_fkey"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_status_enum" AS ENUM('pending', 'completed', 'failed', 'cancelled', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_payment_type_enum" AS ENUM('recording_access', 'highlight_access', 'media_access')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "recording_id" uuid, "media_upload_id" uuid, "razorpay_order_id" character varying(100) NOT NULL, "razorpay_payment_id" character varying(100), "razorpay_signature" character varying(100), "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'INR', "status" "public"."payments_status_enum" NOT NULL DEFAULT 'pending', "payment_type" "public"."payments_payment_type_enum" NOT NULL, "description" text, "metadata" jsonb, "paid_at" TIMESTAMP, "expires_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_427785468fb7d2733f59e7d7d3" ON "payments" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a8f6a5fc345b1953286d67b1d" ON "payments" ("recording_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7c3a152cd1ad46994f375b43b8" ON "payments" ("media_upload_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6893f3785b8358418f32b74038" ON "payments" ("razorpay_order_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7d1bec5311dcddd28c50547e8" ON "payments" ("razorpay_payment_id") `,
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
      `ALTER TABLE "recording_highlights" DROP COLUMN "mux_public_playback_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD "mux_public_playback_url" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN "s3path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD "s3path" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ALTER COLUMN "created_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ALTER COLUMN "updated_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP CONSTRAINT "FK_99947ce5bbb28e4ccbd5672e283"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ALTER COLUMN "userId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ALTER COLUMN "cameraId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP CONSTRAINT "FK_7c83affd6ab277842be21606662"`,
    );
    await queryRunner.query(`ALTER TABLE "cameras" DROP COLUMN "name"`);
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD "name" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ALTER COLUMN "turfId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN "raspberryPiBaseUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD "raspberryPiBaseUrl" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "read_at" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_devices_token" ADD CONSTRAINT "FK_d1191951d3e9fa1719cb6be720a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_427785468fb7d2733f59e7d7d39" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_4a8f6a5fc345b1953286d67b1d3" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_7c3a152cd1ad46994f375b43b89" FOREIGN KEY ("media_upload_id") REFERENCES "media_uploads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD CONSTRAINT "FK_1263e68f2aea723019e32fd49ef" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
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
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD CONSTRAINT "FK_7c83affd6ab277842be21606662" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_928b7aa1754e08e1ed7052cb9d8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "FK_928b7aa1754e08e1ed7052cb9d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP CONSTRAINT "FK_7c83affd6ab277842be21606662"`,
    );
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
      `ALTER TABLE "recording_highlights" DROP CONSTRAINT "FK_1263e68f2aea723019e32fd49ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_7c3a152cd1ad46994f375b43b89"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_4a8f6a5fc345b1953286d67b1d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_427785468fb7d2733f59e7d7d39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_devices_token" DROP CONSTRAINT "FK_d1191951d3e9fa1719cb6be720a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ALTER COLUMN "read_at" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" DROP COLUMN "raspberryPiBaseUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD "raspberryPiBaseUrl" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ALTER COLUMN "turfId" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "cameras" DROP COLUMN "name"`);
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD "name" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cameras" ADD CONSTRAINT "FK_7c83affd6ab277842be21606662" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ALTER COLUMN "cameraId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ALTER COLUMN "userId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99947ce5bbb28e4ccbd5672e283" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "FK_99ac9d3d84bc0d9af703d321a43" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN "s3path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD "s3path" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" DROP COLUMN "mux_public_playback_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD "mux_public_playback_url" character varying`,
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
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7d1bec5311dcddd28c50547e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6893f3785b8358418f32b74038"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c3a152cd1ad46994f375b43b8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a8f6a5fc345b1953286d67b1d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_427785468fb7d2733f59e7d7d3"`,
    );
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payments_payment_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD CONSTRAINT "fk_camera_turf" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "recording_highlights" ADD CONSTRAINT "fk_recording" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_devices_token" ADD CONSTRAINT "user_devices_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
