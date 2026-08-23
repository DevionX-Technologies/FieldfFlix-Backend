/**
 * Backfill Mux ingestion for ALL recordings missing a playable mux_playback_id
 * (not limited to a single IST date).
 *
 * Usage (FieldFlix-Backend-clean):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-all-mux.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-all-mux.ts --limit=50
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-all-mux.ts --concurrency=3
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-all-mux.ts --skip-highlights
 *
 * Requires .env: DB_*, MUX_TOKEN_*, AWS_* (for S3 presign when uploading).
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataSource, In, Not } from 'typeorm';
import { Recording } from '../src/recording/entities/recording.entity';
import { RecordingService } from '../src/recording/service/recording.service';
import { RecordingHighlightsService } from '../src/recording/service/recording-highlight.service';

function arg(name: string): string | undefined {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const TERMINAL_ACTIONS = new Set([
  'already_ready',
  'no_source_video',
  'no_source_video_permanent',
  'no_source_video_pending',
]);

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const skipHighlights = process.argv.includes('--skip-highlights');
  const limit = Math.max(0, parseInt(arg('--limit') || '0', 10));
  const concurrency = Math.max(
    1,
    Math.min(
      8,
      parseInt(
        arg('--concurrency') || process.env.MUX_CYCLE_CONCURRENCY || '5',
        10,
      ),
    ),
  );
  const maxRounds = Math.max(1, parseInt(arg('--rounds') || '12', 10));
  const roundDelayMs = Math.max(
    0,
    parseInt(arg('--round-delay-ms') || '30000', 10),
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    const recordingService = app.get(RecordingService);
    const highlightService = app.get(RecordingHighlightsService);
    const repo = dataSource.getRepository(Recording);

    const all = await repo.find({
      where: {
        status: Not(In(['failed', 'cancelled', 'interrupted'])),
      },
      order: { startTime: 'ASC', id: 'ASC' },
    });

    let needing = all.filter(
      (rec) => !recordingService.isRecordingMuxPlayable(rec),
    );
    if (limit > 0) needing = needing.slice(0, limit);

    console.log(
      `[backfill-all-mux] ${needing.length} recording(s) need Mux (${all.length} total non-terminal)`,
    );
    if (dryRun) {
      for (const rec of needing.slice(0, 20)) {
        console.log(
          `  dry-run ${rec.id.slice(0, 8)} status=${rec.status} s3=${rec.s3Path ? 'yes' : 'no'} mux_asset=${rec.mux_asset_id ?? 'none'}`,
        );
      }
      if (needing.length > 20)
        console.log(`  ... and ${needing.length - 20} more`);
      return;
    }

    const summary: Record<string, number> = {};
    const processed = new Set<string>();

    for (let round = 1; round <= maxRounds; round += 1) {
      const pending = needing.filter((rec) => {
        if (processed.has(rec.id)) {
          const last = resultsById.get(rec.id);
          if (last && TERMINAL_ACTIONS.has(last.action)) return false;
        }
        return !recordingService.isRecordingMuxPlayable(rec);
      });

      if (pending.length === 0) {
        console.log(
          `[backfill-all-mux] round ${round}: nothing left to process`,
        );
        break;
      }

      console.log(
        `[backfill-all-mux] round ${round}/${maxRounds}: ${pending.length} candidate(s), concurrency=${concurrency}`,
      );

      for (const batch of chunk(pending, concurrency)) {
        await Promise.all(
          batch.map(async (rec) => {
            try {
              const result = await recordingService.retryMuxIngestion(rec.id);
              processed.add(rec.id);
              summary[result.action] = (summary[result.action] ?? 0) + 1;
              resultsById.set(rec.id, result);
              console.log(
                `[mux] ${rec.id.slice(0, 8)} → ${result.action}${result.ok ? '' : ' (not ok)'}`,
              );
            } catch (err) {
              const message = (err as Error)?.message ?? String(err);
              processed.add(rec.id);
              summary.failed = (summary.failed ?? 0) + 1;
              resultsById.set(rec.id, { ok: false, action: 'failed' });
              console.warn(`[mux] ${rec.id.slice(0, 8)} FAILED: ${message}`);
            }
          }),
        );
      }

      if (round < maxRounds && roundDelayMs > 0) {
        await sleep(roundDelayMs);
      }

      // Refresh playable state for next round
      for (const rec of pending) {
        const fresh = await repo.findOne({ where: { id: rec.id } });
        if (fresh) Object.assign(rec, fresh);
      }
    }

    console.log('\n[backfill-all-mux] video phase summary:', summary);

    if (!skipHighlights) {
      const playable = await repo.find({
        where: {
          status: In(['ready', 'completed']),
        },
        order: { startTime: 'ASC' },
      });
      const withMux = playable.filter((r) => !!r.mux_playback_id);
      console.log(
        `\n[backfill-all-mux] highlight heal phase: ${withMux.length} playable recording(s)`,
      );

      const hlSummary: Record<string, number> = {};
      for (const batch of chunk(withMux, concurrency)) {
        await Promise.all(
          batch.map(async (rec) => {
            try {
              const result =
                await highlightService.healHighlightMuxForRecording(rec.id);
              hlSummary[result.action] = (hlSummary[result.action] ?? 0) + 1;
              console.log(
                `[hl-mux] ${rec.id.slice(0, 8)} → ${result.action} (${result.highlightMux?.total ?? 0} highlights)`,
              );
            } catch (err) {
              hlSummary.hl_failed = (hlSummary.hl_failed ?? 0) + 1;
              console.warn(
                `[hl-mux] ${rec.id.slice(0, 8)} FAILED: ${(err as Error)?.message ?? err}`,
              );
            }
          }),
        );
      }
      console.log('[backfill-all-mux] highlight phase summary:', hlSummary);
    }
  } finally {
    await app.close();
  }
}

const resultsById = new Map<string, { ok: boolean; action: string }>();

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
