import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the R2/Cloudflare-Stream extraction pipeline schema.
 *
 * These tables and columns were previously only materialised by TypeORM's
 * `synchronize: true`, which is enabled whenever ENVIRONMENT is dev/development.
 * That meant the entire pipeline schema was absent from any database where
 * `synchronize` was off (i.e. production), and — worse — a dev boot holding a
 * production DATABASE_URL would run schema sync against production.
 *
 * Every statement is idempotent so this is safe to run against databases that
 * were previously created by `synchronize`.
 */
export class CreateExtractionPipeline1787300000000 implements MigrationInterface {
  name = 'CreateExtractionPipeline1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // recordings: dedup fingerprint
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "recording_fingerprint" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "recording_name" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_recordings_fingerprint"
         ON "recordings" ("recording_fingerprint")
       WHERE "recording_fingerprint" IS NOT NULL`,
    );

    // ------------------------------------------------------------------
    // extraction_requests: per-user request for a physical recording
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "extraction_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recordingId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "requested_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_extraction_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_extraction_requests_user"
         ON "extraction_requests" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_extraction_requests_recording"
         ON "extraction_requests" ("recordingId")`,
    );

    // ------------------------------------------------------------------
    // extraction_jobs: the dispatch queue
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "extraction_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recordingId" uuid NOT NULL,
        "status" character varying NOT NULL DEFAULT 'QUEUED',
        "retry_count" integer NOT NULL DEFAULT 0,
        "max_retries" integer NOT NULL DEFAULT 3,
        "worker_id" character varying,
        "pi_base_url" character varying,
        "error_code" character varying,
        "error_message" text,
        "first_queued_at" timestamp,
        "queued_at" timestamp,
        "dispatched_at" timestamp,
        "nvr_download_started_at" timestamp,
        "nvr_download_completed_at" timestamp,
        "upload_started_at" timestamp,
        "upload_completed_at" timestamp,
        "r2_ready_at" timestamp,
        "stream_import_started_at" timestamp,
        "stream_ready_at" timestamp,
        "failed_at" timestamp,
        "next_retry_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_extraction_jobs" PRIMARY KEY ("id")
      )
    `);

    // The table may already exist: earlier deployments relied on TypeORM
    // `synchronize` to create it, and `CREATE TABLE IF NOT EXISTS` above is a
    // no-op in that case. Re-assert every column so newly added stage
    // timestamps are applied to pre-existing databases too.
    const jobColumns: Array<[string, string]> = [
      ['pi_base_url', 'character varying'],
      ['first_queued_at', 'timestamp'],
      ['queued_at', 'timestamp'],
      ['dispatched_at', 'timestamp'],
      ['nvr_download_started_at', 'timestamp'],
      ['nvr_download_completed_at', 'timestamp'],
      ['upload_started_at', 'timestamp'],
      ['upload_completed_at', 'timestamp'],
      ['r2_ready_at', 'timestamp'],
      ['stream_import_started_at', 'timestamp'],
      ['stream_ready_at', 'timestamp'],
      ['failed_at', 'timestamp'],
      ['next_retry_at', 'timestamp'],
      ['error_code', 'character varying'],
      ['error_message', 'text'],
      ['worker_id', 'character varying'],
    ];
    for (const [column, type] of jobColumns) {
      await queryRunner.query(
        `ALTER TABLE "extraction_jobs" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "extraction_jobs" ALTER COLUMN "recordingId" SET NOT NULL`,
    );

    // Same for extraction_requests.
    await queryRunner.query(
      `ALTER TABLE "extraction_requests" ADD COLUMN IF NOT EXISTS "recordingId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "extraction_requests" ADD COLUMN IF NOT EXISTS "userId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "extraction_requests" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'pending'`,
    );

    // Dispatcher hot path: "oldest eligible job for this Pi".
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_extraction_jobs_dispatch"
         ON "extraction_jobs" ("status", "pi_base_url", "first_queued_at")`,
    );
    // Stale-job sweep.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_extraction_jobs_status_dispatched"
         ON "extraction_jobs" ("status", "dispatched_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_extraction_jobs_recording"
         ON "extraction_jobs" ("recordingId")`,
    );
    // At most one active job per recording — prevents duplicate Pi dispatches
    // when the same asset is requested repeatedly.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_extraction_jobs_active_recording"
         ON "extraction_jobs" ("recordingId")
       WHERE "status" IN ('QUEUED','DISPATCHING','EXTRACTING','UPLOADING_R2','STREAM_IMPORTING')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extraction_jobs_active_recording"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extraction_jobs_recording"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extraction_jobs_status_dispatched"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extraction_jobs_dispatch"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "extraction_jobs"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extraction_requests_recording"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extraction_requests_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "extraction_requests"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_recordings_fingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN IF EXISTS "recording_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN IF EXISTS "recording_fingerprint"`,
    );
  }
}
