import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookEventsTable1760000000002 implements MigrationInterface {
  name = 'CreateWebhookEventsTable1760000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "mux_event_id" VARCHAR(255) NOT NULL,
        "event_type" VARCHAR(100),
        "asset_id" VARCHAR(255),
        "processed_at" TIMESTAMP NOT NULL DEFAULT now(),
        "response_status" VARCHAR(50),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webhook_events_mux_event_id" UNIQUE ("mux_event_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_events_asset_id"
      ON "webhook_events" ("asset_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_events_created_at"
      ON "webhook_events" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_events_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_events_asset_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_events"`);
  }
}
