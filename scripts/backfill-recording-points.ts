#!/usr/bin/env ts-node

/**
 * Backfill RECORDING_CREATE point events for recordings that never received XP.
 * Awards once per user per court session (camera + start + end window).
 *
 * Run: npx ts-node scripts/backfill-recording-points.ts [--dry-run]
 */

import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');

const dbHost = process.env.DB_HOST || 'localhost';
const useSsl =
  process.env.DB_SSL === 'true' ||
  dbHost.includes('rds.amazonaws.com') ||
  dbHost.includes('neon.tech');

const AppDataSource = new DataSource({
  type: 'postgres',
  host: dbHost,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || process.env.DB_NAME || 'fieldflicks',
  synchronize: false,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

function idempotencyKey(
  eventType: string,
  userId: string,
  refId: string,
): string {
  return createHash('sha256')
    .update(`${eventType}::${userId}::${refId}`)
    .digest('hex');
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  const configRow = await AppDataSource.query(
    `SELECT points FROM point_configs WHERE "eventType" = 'recording_create' AND enabled = true LIMIT 1`,
  );
  const points = Number(configRow[0]?.points ?? 5);

  const sessions = await AppDataSource.query(`
    SELECT DISTINCT ON (r."userId", r."cameraId", r."startTime", r."endTime")
      r.id,
      r."userId",
      r."cameraId",
      r."startTime",
      r."endTime"
    FROM recordings r
    WHERE r."userId" IS NOT NULL
      AND r.status IN ('ready', 'completed', 'in_progress', 'extracting')
    ORDER BY r."userId", r."cameraId", r."startTime", r."endTime", r.id ASC
  `);

  let awarded = 0;
  let skipped = 0;

  for (const row of sessions) {
    const userId = String(row.userId);
    const refId = `${row.cameraId}_${new Date(row.startTime).toISOString()}_${new Date(row.endTime).toISOString()}`;
    const key = idempotencyKey('recording_create', userId, refId);

    const existing = await AppDataSource.query(
      `SELECT id FROM point_events WHERE "idempotencyKey" = $1 LIMIT 1`,
      [key],
    );
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] Would award ${points} XP to ${userId} ref=${refId}`,
      );
      awarded += 1;
      continue;
    }

    await AppDataSource.query(
      `INSERT INTO point_events ("userId", "eventType", "refId", "idempotencyKey", points, metadata)
       VALUES ($1, 'recording_create', $2, $3, $4, $5::jsonb)`,
      [
        userId,
        refId,
        key,
        points,
        JSON.stringify({ recordingId: row.id, source: 'backfill' }),
      ],
    );

    await AppDataSource.query(
      `INSERT INTO user_points ("userId", "totalPoints")
       VALUES ($1, $2)
       ON CONFLICT ("userId")
       DO UPDATE SET "totalPoints" = user_points."totalPoints" + EXCLUDED."totalPoints"`,
      [userId, points],
    );

    awarded += 1;
  }

  if (!dryRun) {
    await AppDataSource.query(`
      UPDATE user_points up
      SET "totalPoints" = sub.total
      FROM (
        SELECT "userId", COALESCE(SUM(points), 0)::int AS total
        FROM point_events
        GROUP BY "userId"
      ) sub
      WHERE up."userId" = sub."userId"
        AND up."totalPoints" <> sub.total
    `);
  }

  console.log(
    `Done. Awarded=${awarded}, skipped(existing)=${skipped}, dryRun=${dryRun}`,
  );
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
