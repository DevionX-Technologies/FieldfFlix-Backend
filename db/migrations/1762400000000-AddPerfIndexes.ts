import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds composite + single-column btree indexes on the most frequently
 * filtered/sorted columns. None are unique; all are CONCURRENT-safe-ish (we use
 * IF NOT EXISTS so re-runs are no-ops).
 *
 * Hot paths covered:
 *   - cameras.turfId               -- /cameras?turfId=X (Find Recordings dropdown)
 *   - recordings.turfId,startTime  -- find-and-claim, /sessions, my-recordings
 *   - recordings.cameraId          -- single-camera history lookups
 *   - recordings.userId,startTime  -- "my recordings" sorted by recency
 *   - recording_highlights.recording_id  -- highlights list per recording
 *   - shared_recordings.recording_id, .shared_with_user_id  -- "shared with me" join
 *   - flick_shorts.recording_id, .approved_at
 *   - payments.(user_id,status)    -- "any pending payment for this user?"
 *   - payments.(recording_id,status)  -- "is this recording already unlocked?"
 *
 * NB: for very large tables consider `CREATE INDEX CONCURRENTLY` (cannot run
 * inside a transaction). TypeORM wraps migrations in a transaction by default,
 * so we use the standard non-concurrent form here. Run during a low-traffic
 * window if any of these tables already have millions of rows.
 */
export class AddPerfIndexes1762400000000 implements MigrationInterface {
  name = 'AddPerfIndexes1762400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const stmts: string[] = [
      `CREATE INDEX IF NOT EXISTS "idx_cameras_turfId" ON "cameras" ("turfId")`,

      `CREATE INDEX IF NOT EXISTS "idx_recordings_turfId" ON "recordings" ("turfId")`,
      `CREATE INDEX IF NOT EXISTS "idx_recordings_cameraId" ON "recordings" ("cameraId")`,
      `CREATE INDEX IF NOT EXISTS "idx_recordings_userId" ON "recordings" ("userId")`,
      `CREATE INDEX IF NOT EXISTS "idx_recordings_startTime" ON "recordings" ("startTime" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_recordings_turfId_startTime" ON "recordings" ("turfId", "startTime" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_recordings_userId_startTime" ON "recordings" ("userId", "startTime" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_recordings_status" ON "recordings" ("status")`,

      `CREATE INDEX IF NOT EXISTS "idx_recording_highlights_recordingId" ON "recording_highlights" ("recording_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_recording_highlights_status" ON "recording_highlights" ("status")`,

      `CREATE INDEX IF NOT EXISTS "idx_shared_recordings_recording_id" ON "shared_recordings" ("recording_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_shared_recordings_shared_with_user_id" ON "shared_recordings" ("shared_with_user_id")`,

      `CREATE INDEX IF NOT EXISTS "idx_flick_shorts_recording_id" ON "flick_shorts" ("recording_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_flick_shorts_status_approved_at" ON "flick_shorts" ("status", "approved_at" DESC)`,

      `CREATE INDEX IF NOT EXISTS "idx_payments_user_status" ON "payments" ("user_id", "status")`,
      `CREATE INDEX IF NOT EXISTS "idx_payments_recording_status" ON "payments" ("recording_id", "status")`,

      `CREATE INDEX IF NOT EXISTS "idx_turfs_name_lower" ON "turfs" (LOWER("name"))`,
      `CREATE INDEX IF NOT EXISTS "idx_turfs_sports_supported_gin" ON "turfs" USING GIN ("sports_supported")`,
    ];

    for (let i = 0; i < stmts.length; i++) {
      const sp = `sp_add_perf_${i}`;
      await queryRunner.query(`SAVEPOINT ${sp}`);
      try {
        await queryRunner.query(stmts[i]);
        await queryRunner.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (err) {
        await queryRunner.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        // eslint-disable-next-line no-console
        console.warn(
          `[AddPerfIndexes] skipped: ${stmts[i]} :: ${(err as Error).message}`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const stmts: string[] = [
      `DROP INDEX IF EXISTS "idx_turfs_sports_supported_gin"`,
      `DROP INDEX IF EXISTS "idx_turfs_name_lower"`,
      `DROP INDEX IF EXISTS "idx_payments_recording_status"`,
      `DROP INDEX IF EXISTS "idx_payments_user_status"`,
      `DROP INDEX IF EXISTS "idx_flick_shorts_status_approved_at"`,
      `DROP INDEX IF EXISTS "idx_flick_shorts_recording_id"`,
      `DROP INDEX IF EXISTS "idx_shared_recordings_shared_with_user_id"`,
      `DROP INDEX IF EXISTS "idx_shared_recordings_shared_to_user_id"`,
      `DROP INDEX IF EXISTS "idx_shared_recordings_recording_id"`,
      `DROP INDEX IF EXISTS "idx_recording_highlights_status"`,
      `DROP INDEX IF EXISTS "idx_recording_highlights_recordingId"`,
      `DROP INDEX IF EXISTS "idx_recordings_status"`,
      `DROP INDEX IF EXISTS "idx_recordings_userId_startTime"`,
      `DROP INDEX IF EXISTS "idx_recordings_turfId_startTime"`,
      `DROP INDEX IF EXISTS "idx_recordings_startTime"`,
      `DROP INDEX IF EXISTS "idx_recordings_userId"`,
      `DROP INDEX IF EXISTS "idx_recordings_cameraId"`,
      `DROP INDEX IF EXISTS "idx_recordings_turfId"`,
      `DROP INDEX IF EXISTS "idx_cameras_turfId"`,
    ];

    for (const sql of stmts) {
      await queryRunner.query(sql);
    }
  }
}
