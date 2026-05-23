import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateMediaUploadsSchema1747297045404 implements MigrationInterface {
  name = 'UpdateMediaUploadsSchema1747297045404';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "turf_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "turf_id" uuid NOT NULL, "file_name" character varying, "content_type" character varying(50) NOT NULL, "file_size" bigint, "image_url" character varying(255) NOT NULL, "bucket_name" character varying(255) NOT NULL, "is_turf_profile" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d8ced44e02e9cbac0438276c302" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "turf_amenities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "turf_id" uuid NOT NULL, "has_parking" boolean NOT NULL DEFAULT false, "has_changing_room" boolean NOT NULL DEFAULT false, "has_washroom" boolean NOT NULL DEFAULT false, "has_drinking_water" boolean NOT NULL DEFAULT false, "has_first_aid" boolean NOT NULL DEFAULT false, "has_floodlights" boolean NOT NULL DEFAULT false, "has_equipment_rental" boolean NOT NULL DEFAULT false, "has_refreshments" boolean NOT NULL DEFAULT false, "has_wifi" boolean NOT NULL DEFAULT false, "has_seating_area" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_903e800871ac31a826cacc95ff" UNIQUE ("turf_id"), CONSTRAINT "PK_259d2e6bfd30ba0e01e97428a57" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_903e800871ac31a826cacc95ff" ON "turf_amenities" ("turf_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "turfs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "description" character varying, "size_length" numeric(6,2), "size_width" numeric(6,2), "surface_type" "public"."ESurfaceType" array NOT NULL DEFAULT '{artificial_Grass}', "sports_supported" "public"."ESportsSupported" array NOT NULL DEFAULT '{Football}', "geo_location" geometry(Point,4326), "address_line" character varying(1000), "city" character varying(100), "state" character varying(100), "postal_code" character varying(10), "country" character varying(100), "hourly_rate" numeric(10,2), "opening_time" TIME, "closing_time" TIME, "max_capacity" integer, "is_active" boolean NOT NULL DEFAULT true, "contact_phone" character varying(20), "contact_email" character varying(100), "cancellation_policy" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ed5a2c678845e4dedeef4befecd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "media_uploads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "file_size" bigint, "turf_id" uuid, "file_name" character varying(255) NOT NULL, "bucket_name" character varying(255) NOT NULL, "user_id" uuid, "media_url" character varying(255) NOT NULL, "media_upload_type" character varying(50) NOT NULL DEFAULT 'VIDEO', "content_type" character varying(50) NOT NULL, "is_favorite" boolean NOT NULL DEFAULT false, "share_token" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_aa6553e7a799c14ece6781a6e85" UNIQUE ("share_token"), CONSTRAINT "PK_af36cb16c5cc7d6bab1f6d4d289" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c772379c02c87257205f86959b" ON "media_uploads" ("turf_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aa6553e7a799c14ece6781a6e8" ON "media_uploads" ("share_token") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_devices_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "devices_id" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_bfe4dadcc2be4c90b1eff9ffba9" UNIQUE ("devices_id"), CONSTRAINT "PK_01182bcf269905362f21ad89457" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying, "name" character varying, "profile_image_path" character varying, "bucket_name" character varying, "phone_number" character varying, "singUp_Method" "public"."SingUpType", "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "title" character varying, "body" text, "data" jsonb NOT NULL, "message_status" "public"."notification_lead_type" NOT NULL DEFAULT 'unread', "notification_type" character varying, "is_soft_delete" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_705b6c7cdf9b2c2ff7ac7872cb7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "otps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "otp" character varying NOT NULL, "otp_expiry" TIMESTAMP NOT NULL, "phone_number" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_91fef5ed60605b854a2115d2410" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "turf_images" ADD CONSTRAINT "FK_90137feaec3d59439b78b7f2549" FOREIGN KEY ("turf_id") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "turf_amenities" ADD CONSTRAINT "FK_903e800871ac31a826cacc95ffa" FOREIGN KEY ("turf_id") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" ADD CONSTRAINT "FK_c772379c02c87257205f86959ba" FOREIGN KEY ("turf_id") REFERENCES "turfs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" ADD CONSTRAINT "FK_93409e9cac5e758a75f00cc0335" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_devices_token" ADD CONSTRAINT "FK_d1191951d3e9fa1719cb6be720a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_928b7aa1754e08e1ed7052cb9d8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "FK_928b7aa1754e08e1ed7052cb9d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_devices_token" DROP CONSTRAINT "FK_d1191951d3e9fa1719cb6be720a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" DROP CONSTRAINT "FK_93409e9cac5e758a75f00cc0335"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media_uploads" DROP CONSTRAINT "FK_c772379c02c87257205f86959ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "turf_amenities" DROP CONSTRAINT "FK_903e800871ac31a826cacc95ffa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "turf_images" DROP CONSTRAINT "FK_90137feaec3d59439b78b7f2549"`,
    );
    await queryRunner.query(`DROP TABLE "otps"`);
    await queryRunner.query(`DROP TABLE "notification"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "user_devices_token"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa6553e7a799c14ece6781a6e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c772379c02c87257205f86959b"`,
    );
    await queryRunner.query(`DROP TABLE "media_uploads"`);
    await queryRunner.query(`DROP TABLE "turfs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_903e800871ac31a826cacc95ff"`,
    );
    await queryRunner.query(`DROP TABLE "turf_amenities"`);
    await queryRunner.query(`DROP TABLE "turf_images"`);
  }
}
