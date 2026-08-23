/**
 * Re-run S3 highlight attach for every recording with a valid time window.
 * Uses UTC parsing from s3-highlight-key.util (Pi gateway UTC wall clock).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/reattach-all-s3-highlights.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/reattach-all-s3-highlights.ts --limit=100
 *   npx ts-node -r tsconfig-paths/register scripts/reattach-all-s3-highlights.ts --since=2025-08-01
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { Recording } from '../src/recording/entities/recording.entity';
import { RecordingHighlightsService } from '../src/recording/service/recording-highlight.service';

function arg(name: string): string | undefined {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limit = Math.max(0, parseInt(arg('--limit') || '0', 10));
  const since = arg('--since');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    const highlightService = app.get(RecordingHighlightsService);
    const repo = dataSource.getRepository(Recording);

    let qb = repo
      .createQueryBuilder('r')
      .where('r."cameraId" IS NOT NULL')
      .andWhere('r."startTime" IS NOT NULL')
      .andWhere('r."endTime" IS NOT NULL')
      .orderBy('r."startTime"', 'ASC');

    if (since) {
      qb = qb.andWhere('r."startTime" >= :since', {
        since: new Date(`${since}T00:00:00+05:30`),
      });
    }

    let rows = await qb.getMany();
    if (limit > 0) rows = rows.slice(0, limit);

    console.log(
      `[reattach-all] ${rows.length} recording(s) with camera + time window${since ? ` since ${since}` : ''}`,
    );

    let totalAttached = 0;
    let withNew = 0;

    for (const rec of rows) {
      if (!rec.cameraId || !rec.startTime || !rec.endTime) continue;

      if (dryRun) {
        console.log(
          `  dry-run ${rec.id.slice(0, 8)} cam=${rec.cameraId.slice(0, 8)} ${rec.startTime.toISOString()} → ${rec.endTime.toISOString()}`,
        );
        continue;
      }

      const attached = await highlightService.attachHighlightsInTimeWindow(
        rec.id,
        rec.cameraId,
        rec.startTime,
        rec.endTime,
      );

      totalAttached += attached;
      if (attached > 0) {
        withNew += 1;
        console.log(
          `[reattach] ${rec.id.slice(0, 8)} +${attached} highlight(s) (${rec.startTime.toISOString()})`,
        );
      }
    }

    console.log(
      `\n[reattach-all] done: ${totalAttached} highlight row(s) attached across ${withNew} recording(s)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
