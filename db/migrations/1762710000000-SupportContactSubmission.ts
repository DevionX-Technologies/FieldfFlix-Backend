import { MigrationInterface, QueryRunner } from 'typeorm';

export class SupportContactSubmission1762710000000 implements MigrationInterface {
  name = 'SupportContactSubmission1762710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "support_contact_submission" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "issue_type" character varying(32) NOT NULL,
        "full_name" character varying(120) NOT NULL,
        "mobile" character varying(20) NOT NULL,
        "description" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_contact_submission" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_support_contact_submission_created_at"
      ON "support_contact_submission" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_support_contact_submission_created_at"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "support_contact_submission"`,
    );
  }
}
