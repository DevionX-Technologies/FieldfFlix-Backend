/**
 * Report Mux static MP4 (highest) status for highlight clip assets.
 *
 * Uses the same .env as the API: DB_*, MUX_TOKEN_ID, MUX_TOKEN_SECRET.
 * Read-only — does not invoke Lambda or modify the database. Prints DB `metadata.muxStaticMp4.status` for comparison with live Mux.
 *
 * Columns: `sr_count` / `sr_bucket` come from `static_renditions.files` and `static_renditions.status` (Mux nests files under an object, not a top-level array).
 *
 * Usage (from FieldFlix-Backend-clean):
 *   npx ts-node -r tsconfig-paths/register scripts/audit-highlight-mux-static-mp4.ts --limit=100
 *   npx ts-node -r tsconfig-paths/register scripts/audit-highlight-mux-static-mp4.ts --recording-id=<uuid> --limit=500
 *   npx ts-node -r tsconfig-paths/register scripts/audit-highlight-mux-static-mp4.ts --limit=50 --json
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { MUX_API_BASE_URL } from '../src/constant/constant';
import {
  muxStaticRenditionFileRows,
  muxStaticRenditionsBucketStatus,
} from '../src/utils/mux-static-renditions';

function arg(name: string): string | undefined {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

type RenditionSummary = {
  mp4Status: 'none' | 'preparing' | 'ready' | 'errored' | 'skipped' | 'mixed';
  mp4Detail: string;
};

function summarizeMp4Renditions(staticRenditions: unknown): RenditionSummary {
  const rows = muxStaticRenditionFileRows(staticRenditions);
  const bucket = muxStaticRenditionsBucketStatus(staticRenditions);

  if (rows.length === 0) {
    if (bucket === 'preparing') {
      return {
        mp4Status: 'preparing',
        mp4Detail: 'static_renditions.preparing',
      };
    }
    if (bucket === 'errored') {
      return {
        mp4Status: 'errored',
        mp4Detail: 'static_renditions.errored',
      };
    }
    if (bucket === 'ready') {
      return {
        mp4Status: 'none',
        mp4Detail: 'bucket ready, no file rows',
      };
    }
    return { mp4Status: 'none', mp4Detail: 'no static_renditions' };
  }
  const mp4 = rows.filter(
    (r) => r && typeof r === 'object' && String((r as { ext?: string }).ext) === 'mp4',
  ) as Array<{ status?: string; name?: string }>;

  if (mp4.length === 0) {
    return { mp4Status: 'none', mp4Detail: 'no mp4 rows' };
  }

  const ready = mp4.find((r) => String(r.status || '') === 'ready');
  if (ready?.name) {
    return { mp4Status: 'ready', mp4Detail: ready.name };
  }

  if (
    mp4.some((r) =>
      ['preparing', 'waiting'].includes(String(r.status || '')),
    )
  ) {
    const p = mp4.find((r) =>
      ['preparing', 'waiting'].includes(String(r.status || '')),
    );
    return {
      mp4Status: 'preparing',
      mp4Detail: String(p?.status || 'preparing'),
    };
  }

  if (mp4.some((r) => String(r.status || '') === 'skipped')) {
    return { mp4Status: 'skipped', mp4Detail: 'skipped (mux)' };
  }

  if (mp4.every((r) => String(r.status || '') === 'errored')) {
    return { mp4Status: 'errored', mp4Detail: 'all errored' };
  }

  return {
    mp4Status: 'mixed',
    mp4Detail: mp4.map((r) => String(r.status ?? '?')).join(','),
  };
}

async function main() {
  const limit = Math.max(1, parseInt(arg('--limit') ?? '100', 10) || 100);
  const recordingId = arg('--recording-id');
  const asJson = process.argv.includes('--json');
  const delayMs = Math.max(
    0,
    parseInt(arg('--delay-ms') ?? '120', 10) || 120,
  );

  const muxTokenId = process.env.MUX_TOKEN_ID;
  const muxTokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!muxTokenId || !muxTokenSecret) {
    console.error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set (same as API).');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);

    const conditions = [
      `rh.asset_id IS NOT NULL`,
      `TRIM(rh.asset_id) <> ''`,
      `(rh.status IS NULL OR rh.status NOT IN ('failed', 'permanently_failed'))`,
    ];
    const params: unknown[] = [];
    let paramIndex = 1;
    if (recordingId) {
      conditions.push(`rh.recording_id = $${paramIndex++}`);
      params.push(recordingId);
    }
    params.push(limit);

    const sql = `
      SELECT
        rh.id AS highlight_id,
        rh.recording_id AS recording_id,
        COALESCE(rh.status, '') AS db_status,
        COALESCE(rh.metadata->'muxStaticMp4'->>'status', '') AS db_mux_mp4_status,
        rh.asset_id AS mux_asset_id,
        COALESCE(rh.playback_id, '') AS playback_id
      FROM recording_highlights rh
      WHERE ${conditions.join(' AND ')}
      ORDER BY rh.created_at DESC
      LIMIT $${paramIndex}
    `;

    const rows = (await dataSource.query(sql, params)) as Array<{
      highlight_id: string;
      recording_id: string;
      db_status: string;
      db_mux_mp4_status: string;
      mux_asset_id: string;
      playback_id: string;
    }>;

    const results: Array<
      (typeof rows)[0] &
        RenditionSummary & {
          muxError?: string;
          mux_asset_status: string;
          mux_mp4_support: string;
          mux_sr_bucket: string;
          sr_count: number;
        }
    > = [];

    const tallies: Record<RenditionSummary['mp4Status'], number> = {
      none: 0,
      preparing: 0,
      ready: 0,
      errored: 0,
      skipped: 0,
      mixed: 0,
    };

    let muxFetchErrors = 0;

    for (const row of rows) {
      let muxError: string | undefined;
      let summary: RenditionSummary = {
        mp4Status: 'none',
        mp4Detail: 'not fetched',
      };
      let mux_asset_status = '';
      let mux_mp4_support = '';
      let mux_sr_bucket = '';
      let sr_count = 0;

      try {
        const res = await axios.get(
          `${MUX_API_BASE_URL}/video/v1/assets/${encodeURIComponent(row.mux_asset_id)}`,
          {
            auth: { username: muxTokenId, password: muxTokenSecret },
            timeout: 30_000,
          },
        );
        const data = res.data?.data as Record<string, unknown> | undefined;
        const sr = data?.static_renditions;
        mux_asset_status =
          data?.status != null && data.status !== ''
            ? String(data.status)
            : '';
        mux_mp4_support =
          data?.mp4_support != null && data.mp4_support !== ''
            ? String(data.mp4_support)
            : '';
        mux_sr_bucket = muxStaticRenditionsBucketStatus(sr);
        sr_count = muxStaticRenditionFileRows(sr).length;
        summary = summarizeMp4Renditions(sr);
      } catch (e: unknown) {
        const ax = e as { response?: { status?: number } };
        muxError =
          ax.response?.status != null
            ? `http_${ax.response.status}`
            : 'request_failed';
        summary = { mp4Status: 'none', mp4Detail: muxError };
        muxFetchErrors++;
      }

      if (!muxError) {
        tallies[summary.mp4Status]++;
      }

      results.push({
        ...row,
        ...summary,
        muxError,
        mux_asset_status,
        mux_mp4_support,
        mux_sr_bucket,
        sr_count,
      });

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            limit,
            recordingId: recordingId ?? null,
            tallies,
            muxFetchErrors,
            rows: results,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `Audited ${results.length} highlight(s) with Mux asset_id` +
        (recordingId ? ` (recording ${recordingId})` : '') +
        '.\n',
    );
    console.log('Tallies (Mux MP4 static, successful fetches only):');
    for (const k of Object.keys(tallies) as Array<keyof typeof tallies>) {
      console.log(`  ${k}: ${tallies[k]}`);
    }
    if (muxFetchErrors > 0) {
      console.log(`  mux_fetch_errors: ${muxFetchErrors}`);
    }
    console.log('');

    const head =
      'mp4_status\tmp4_detail\tmux_status\tsr_bucket\tsr_count\tmp4_support\tdb_mux_mp4_status\tdb_status\thighlight_id\trecording_id\tmux_asset_id\tplayback_id';
    console.log(head);
    for (const r of results) {
      const line = [
        r.mp4Status,
        r.mp4Detail.replace(/\t/g, ' '),
        r.mux_asset_status || '-',
        r.mux_sr_bucket || '-',
        String(r.sr_count),
        r.mux_mp4_support || '-',
        r.db_mux_mp4_status || '-',
        r.db_status,
        r.highlight_id,
        r.recording_id,
        r.mux_asset_id,
        r.playback_id || '-',
      ].join('\t');
      console.log(line);
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
