/**
 * Backfill MP4 exports (S3) for highlights that have Mux playback but no s3path.
 *
 * Prerequisites: same .env as the API (DB, MUX_CONVERTER_LAMBDA_FUNCTION_NAME, etc.).
 * Lambda invoke needs AWS credentials the SDK can resolve: put AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, and AWS_REGION in `.env` / `.env.<ENVIRONMENT>`, or use
 * `aws configure` / `$env:AWS_PROFILE='your-profile'` in PowerShell before running.
 * Without this you will see: CredentialsProviderError: Could not load credentials from any providers.
 *
 * Ops-only — bypasses per-recording “unlock” if you set:
 *   HIGHLIGHT_EXPORT_BACKFILL_SKIP_ENTITLEMENT=true
 * Remove that env after the run in shared environments.
 *
 * Usage (from FieldFlix-Backend-clean):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mp4.ts --limit=20
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mp4.ts --recording-id=<uuid> --limit=5
 *
 * Dry run (list only):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mp4.ts --limit=50 --dry-run
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RecordingService } from '../src/recording/service/recording.service';
import { DataSource } from 'typeorm';

function arg(name: string): string | undefined {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

async function main() {
  const limit = Math.max(1, parseInt(arg('--limit') ?? '10', 10) || 10);
  const recordingId = arg('--recording-id');
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log(
      '[dry-run] Would process up to',
      limit,
      'highlights',
      recordingId ? `for recording ${recordingId}` : '',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    const recordingService = app.get(RecordingService);

    const conditions = [
      `(rh.s3path IS NULL OR rh.s3path = '')`,
      `(rh.status IS NULL OR rh.status NOT IN ('failed', 'permanently_failed'))`,
      `(rh.mux_public_playback_url IS NOT NULL OR rh.playback_id IS NOT NULL)`,
    ];
    const params: unknown[] = [];
    let paramIndex = 1;
    if (recordingId) {
      conditions.push(`rh.recording_id = $${paramIndex++}`);
      params.push(recordingId);
    }
    params.push(limit);

    const sql = `
      SELECT rh.id AS id, r."userId" AS "ownerUserId"
      FROM recording_highlights rh
      INNER JOIN recordings r ON r.id = rh.recording_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY rh.created_at DESC
      LIMIT $${paramIndex}
    `;

    const rows = (await dataSource.query(sql, params)) as Array<{
      id: string;
      ownerUserId: string | null;
    }>;

    console.log(`Found ${rows.length} highlight(s) without s3path.`);

    for (const row of rows) {
      const ownerId = row.ownerUserId;
      if (!ownerId) {
        console.warn(`Skip ${row.id}: recording has no userId`);
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] ${row.id} owner=${ownerId}`);
        continue;
      }
      const result = await recordingService.processHighlight(row.id, ownerId);
      console.log(
        `${result.success ? 'OK' : 'FAIL'}\t${row.id}\t${result.message}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
