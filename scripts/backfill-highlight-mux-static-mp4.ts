/**
 * Request Mux static MP4 (`highest`) for highlight clip assets and persist status in DB (metadata.muxStaticMp4).
 *
 * Credentials: same .env as the API — DB_*, MUX_TOKEN_ID, MUX_TOKEN_SECRET.
 * No AWS/Lambda required.
 *
 * Usage (FieldFlix-Backend-clean):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mux-static-mp4.ts --limit=50
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mux-static-mp4.ts --recording-id=<uuid> --limit=100
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mux-static-mp4.ts --limit=20 --wait --max-wait-sec=600
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-highlight-mux-static-mp4.ts --limit=10 --dry-run
 *
 * Default selection: highlights whose metadata.muxStaticMp4.status is not 'ready'. Use --all to rescan every clip.
 *
 * Afterward, verify with: npm run audit:highlight-mux-mp4 -- --limit=...
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { MUX_API_BASE_URL } from '../src/constant/constant';
import {
  muxIsStaticRenditionAlreadyDefinedResponse,
  muxStaticRenditionFileRows,
  muxStaticRenditionsBucketStatus,
} from '../src/utils/mux-static-renditions';

function arg(name: string): string | undefined {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

type Mp4RenditionState =
  | 'none'
  | 'preparing'
  | 'ready'
  | 'errored'
  | 'skipped'
  | 'mixed';

type RenditionSummary = {
  mp4Status: Mp4RenditionState;
  mp4Detail: string;
  mp4FileName: string | null;
};

function summarizeMp4Renditions(staticRenditions: unknown): RenditionSummary {
  const rows = muxStaticRenditionFileRows(staticRenditions);
  const bucket = muxStaticRenditionsBucketStatus(staticRenditions);

  if (rows.length === 0) {
    if (bucket === 'preparing') {
      return {
        mp4Status: 'preparing',
        mp4Detail: 'static_renditions.preparing',
        mp4FileName: null,
      };
    }
    if (bucket === 'errored') {
      return {
        mp4Status: 'errored',
        mp4Detail: 'static_renditions.errored',
        mp4FileName: null,
      };
    }
    if (bucket === 'ready') {
      return {
        mp4Status: 'none',
        mp4Detail: 'bucket ready, no file rows',
        mp4FileName: null,
      };
    }
    return {
      mp4Status: 'none',
      mp4Detail: 'no static_renditions',
      mp4FileName: null,
    };
  }
  const mp4 = rows.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      String((r as { ext?: string }).ext) === 'mp4',
  ) as Array<{ status?: string; name?: string }>;

  if (mp4.length === 0) {
    return { mp4Status: 'none', mp4Detail: 'no mp4 rows', mp4FileName: null };
  }

  const ready = mp4.find((r) => String(r.status || '') === 'ready');
  if (ready?.name) {
    return {
      mp4Status: 'ready',
      mp4Detail: ready.name,
      mp4FileName: ready.name,
    };
  }

  if (
    mp4.some((r) => ['preparing', 'waiting'].includes(String(r.status || '')))
  ) {
    const p = mp4.find((r) =>
      ['preparing', 'waiting'].includes(String(r.status || '')),
    );
    return {
      mp4Status: 'preparing',
      mp4Detail: String(p?.status || 'preparing'),
      mp4FileName: null,
    };
  }

  if (mp4.some((r) => String(r.status || '') === 'skipped')) {
    return {
      mp4Status: 'skipped',
      mp4Detail: 'skipped (mux)',
      mp4FileName: null,
    };
  }

  if (mp4.every((r) => String(r.status || '') === 'errored')) {
    return {
      mp4Status: 'errored',
      mp4Detail: 'all errored',
      mp4FileName: null,
    };
  }

  return {
    mp4Status: 'mixed',
    mp4Detail: mp4.map((r) => String(r.status ?? '?')).join(','),
    mp4FileName: null,
  };
}

async function fetchMuxAsset(
  assetId: string,
  muxTokenId: string,
  muxTokenSecret: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await axios.get(
      `${MUX_API_BASE_URL}/video/v1/assets/${encodeURIComponent(assetId)}`,
      {
        auth: { username: muxTokenId, password: muxTokenSecret },
        timeout: 30_000,
      },
    );
    return { ok: true, data: res.data?.data };
  } catch (e: unknown) {
    const ax = e as { response?: { status?: number } };
    const code =
      ax.response?.status != null
        ? `http_${ax.response.status}`
        : 'request_failed';
    return { ok: false, error: code };
  }
}

function muxHttpErrorSnippet(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data.slice(0, 400);
  try {
    return JSON.stringify(data).slice(0, 400);
  } catch {
    return String(data).slice(0, 400);
  }
}

async function postStaticRenditionHighest(
  assetId: string,
  muxTokenId: string,
  muxTokenSecret: string,
  dryRun: boolean,
): Promise<
  | { ok: true; action: 'posted' | 'dry_run' | 'noop' }
  | { ok: false; message: string }
> {
  if (dryRun) {
    return { ok: true, action: 'dry_run' };
  }
  try {
    const res = await axios.post(
      `${MUX_API_BASE_URL}/video/v1/assets/${encodeURIComponent(assetId)}/static-renditions`,
      { resolution: 'highest' },
      {
        auth: { username: muxTokenId, password: muxTokenSecret },
        validateStatus: (s) =>
          (s >= 200 && s < 300) || s === 409 || s === 422 || s === 400,
        timeout: 30_000,
      },
    );
    if (
      res.status === 400 &&
      muxIsStaticRenditionAlreadyDefinedResponse(res.data)
    ) {
      return { ok: true, action: 'posted' };
    }
    if (res.status === 400) {
      return {
        ok: false,
        message: `Mux POST static-renditions http_400: ${muxHttpErrorSnippet(res.data)}`,
      };
    }
    if (res.status === 422) {
      return {
        ok: false,
        message: `mux rejected static-renditions (422): ${muxHttpErrorSnippet(res.data) || 'no body'}`,
      };
    }
    if ((res.status >= 200 && res.status < 300) || res.status === 409) {
      return { ok: true, action: 'posted' };
    }
    return {
      ok: false,
      message: `Mux POST static-renditions status ${res.status}: ${muxHttpErrorSnippet(res.data)}`,
    };
  } catch (err: unknown) {
    const ax = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    const st = ax.response?.status;
    if (st === 422) {
      return {
        ok: false,
        message: `mux rejected static-renditions (422): ${muxHttpErrorSnippet(ax.response?.data) || 'no body'}`,
      };
    }
    if (st === 409) {
      return { ok: true, action: 'posted' };
    }
    if (
      st === 400 &&
      muxIsStaticRenditionAlreadyDefinedResponse(ax.response?.data)
    ) {
      return { ok: true, action: 'posted' };
    }
    if (st != null) {
      return {
        ok: false,
        message: `Mux POST static-renditions http_${st}: ${muxHttpErrorSnippet(ax.response?.data) || (ax.message?.slice(0, 200) ?? 'no body')}`,
      };
    }
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : String(err);
    return {
      ok: false,
      message: `Mux POST static-renditions failed (no response — network/DNS/TLS?): ${msg}`,
    };
  }
}

async function persistMuxStaticMeta(
  dataSource: DataSource,
  highlightId: string,
  muxAssetId: string,
  playbackId: string,
  status: Mp4RenditionState | string,
  fileName: string | null,
  note: string | null,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    return;
  }
  const updatedAt = new Date().toISOString();
  await dataSource.query(
    `
    UPDATE recording_highlights
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{muxStaticMp4}',
      jsonb_build_object(
        'status', $1::text,
        'name', to_jsonb($2::text),
        'muxAssetId', to_jsonb($3::text),
        'playbackId', to_jsonb($4::text),
        'updatedAt', to_jsonb($5::text),
        'note', to_jsonb($6::text)
      ),
      true
    ),
    updated_at = NOW()
    WHERE id = $7::uuid
    `,
    [
      status,
      fileName ?? '',
      muxAssetId,
      playbackId ?? '',
      updatedAt,
      note ?? '',
      highlightId,
    ],
  );
}

async function main() {
  const limit = Math.max(1, parseInt(arg('--limit') ?? '50', 10) || 50);
  const recordingId = arg('--recording-id');
  const dryRun = process.argv.includes('--dry-run');
  const wait = process.argv.includes('--wait');
  const includeAll = process.argv.includes('--all');
  const delayMs = Math.max(0, parseInt(arg('--delay-ms') ?? '150', 10) || 150);
  const pollSec = Math.max(3, parseInt(arg('--poll-sec') ?? '10', 10) || 10);
  const maxWaitSec = Math.max(
    30,
    parseInt(arg('--max-wait-sec') ?? '900', 10) || 900,
  );

  const muxTokenId = process.env.MUX_TOKEN_ID;
  const muxTokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!muxTokenId || !muxTokenSecret) {
    console.error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set.');
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
    if (!includeAll) {
      conditions.push(`
        (
          rh.metadata IS NULL
          OR rh.metadata->'muxStaticMp4' IS NULL
          OR COALESCE(rh.metadata->'muxStaticMp4'->>'status', '') <> 'ready'
        )
      `);
    }

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
      mux_asset_id: string;
      playback_id: string;
    }>;

    console.log(
      `Selected ${rows.length} highlight(s)${includeAll ? ' (--all)' : ' (not marked ready in metadata)'}${dryRun ? ' [dry-run]' : ''}.`,
    );

    let posted = 0;
    let dbWrites = 0;
    let alreadyReady = 0;
    let errors = 0;

    for (const row of rows) {
      const assetFetch = await fetchMuxAsset(
        row.mux_asset_id,
        muxTokenId,
        muxTokenSecret,
      );
      if (assetFetch.ok === false) {
        errors++;
        const errCode = assetFetch.error;
        console.log(`ERR\t${row.highlight_id}\tmux_get\t${errCode}`);
        if (!dryRun) {
          await persistMuxStaticMeta(
            dataSource,
            row.highlight_id,
            row.mux_asset_id,
            row.playback_id,
            'none',
            null,
            `mux_get:${errCode}`,
            dryRun,
          );
          dbWrites++;
        }
        if (delayMs) await sleep(delayMs);
        continue;
      }

      let summary = summarizeMp4Renditions(
        (assetFetch.data as { static_renditions?: unknown })?.static_renditions,
      );

      if (summary.mp4Status === 'ready' && summary.mp4FileName) {
        alreadyReady++;
        if (!dryRun) {
          await persistMuxStaticMeta(
            dataSource,
            row.highlight_id,
            row.mux_asset_id,
            row.playback_id,
            'ready',
            summary.mp4FileName,
            summary.mp4Detail,
            dryRun,
          );
          dbWrites++;
        }
        console.log(`READY\t${row.highlight_id}\t${summary.mp4FileName}`);
        if (delayMs) await sleep(delayMs);
        continue;
      }

      if (summary.mp4Status === 'skipped' || summary.mp4Status === 'errored') {
        console.log(
          `${summary.mp4Status.toUpperCase()}\t${row.highlight_id}\t${summary.mp4Detail}`,
        );
        if (!dryRun) {
          await persistMuxStaticMeta(
            dataSource,
            row.highlight_id,
            row.mux_asset_id,
            row.playback_id,
            summary.mp4Status,
            null,
            summary.mp4Detail,
            dryRun,
          );
          dbWrites++;
        }
        if (delayMs) await sleep(delayMs);
        continue;
      }

      if (summary.mp4Status === 'none' || summary.mp4Status === 'mixed') {
        const post = await postStaticRenditionHighest(
          row.mux_asset_id,
          muxTokenId,
          muxTokenSecret,
          dryRun,
        );
        if (post.ok === false) {
          errors++;
          const postErr = post.message;
          console.log(`ERR\t${row.highlight_id}\tpost\t${postErr}`);
          if (!dryRun) {
            await persistMuxStaticMeta(
              dataSource,
              row.highlight_id,
              row.mux_asset_id,
              row.playback_id,
              'errored',
              null,
              `post:${postErr}`,
              false,
            );
            dbWrites++;
          }
          if (delayMs) await sleep(delayMs);
          continue;
        }
        posted++;
        summary = {
          mp4Status: 'preparing',
          mp4Detail: dryRun
            ? 'dry-run (no POST)'
            : 'requested highest static rendition',
          mp4FileName: null,
        };
        console.log(`${dryRun ? 'DRY_POST' : 'POST'}\t${row.highlight_id}`);
      } else if (summary.mp4Status === 'preparing') {
        console.log(`PREPARING\t${row.highlight_id}\t${summary.mp4Detail}`);
      }

      if (!dryRun) {
        await persistMuxStaticMeta(
          dataSource,
          row.highlight_id,
          row.mux_asset_id,
          row.playback_id,
          'preparing',
          null,
          summary.mp4Detail,
          dryRun,
        );
        dbWrites++;
      }

      const shouldPoll =
        wait &&
        !dryRun &&
        !!row.playback_id &&
        summary.mp4Status === 'preparing';

      if (shouldPoll) {
        const deadline = Date.now() + maxWaitSec * 1000;
        let last = summary;
        let exitedReady = false;

        while (Date.now() < deadline) {
          await sleep(pollSec * 1000);
          const again = await fetchMuxAsset(
            row.mux_asset_id,
            muxTokenId,
            muxTokenSecret,
          );
          if (again.ok === false) {
            console.log(`ERR_POLL\t${row.highlight_id}\t${again.error}`);
            break;
          }
          last = summarizeMp4Renditions(
            (again.data as { static_renditions?: unknown })?.static_renditions,
          );
          if (last.mp4Status === 'ready' && last.mp4FileName) {
            await persistMuxStaticMeta(
              dataSource,
              row.highlight_id,
              row.mux_asset_id,
              row.playback_id,
              'ready',
              last.mp4FileName,
              last.mp4Detail,
              false,
            );
            dbWrites++;
            exitedReady = true;
            console.log(
              `READY\t${row.highlight_id}\t${last.mp4FileName}\t(poll)`,
            );
            break;
          }
          if (last.mp4Status === 'errored' || last.mp4Status === 'skipped') {
            await persistMuxStaticMeta(
              dataSource,
              row.highlight_id,
              row.mux_asset_id,
              row.playback_id,
              last.mp4Status,
              null,
              last.mp4Detail,
              false,
            );
            dbWrites++;
            console.log(
              `${last.mp4Status.toUpperCase()}\t${row.highlight_id}\t(poll)`,
            );
            break;
          }
        }

        if (
          !exitedReady &&
          last.mp4Status !== 'errored' &&
          last.mp4Status !== 'skipped' &&
          !(last.mp4Status === 'ready' && last.mp4FileName)
        ) {
          console.log(
            `TIMEOUT\t${row.highlight_id}\t${last.mp4Status}\tafter ${maxWaitSec}s`,
          );
          await persistMuxStaticMeta(
            dataSource,
            row.highlight_id,
            row.mux_asset_id,
            row.playback_id,
            'preparing',
            null,
            `poll_timeout_${maxWaitSec}s`,
            false,
          );
          dbWrites++;
        }
      }

      if (delayMs) await sleep(delayMs);
    }

    console.log('\nDone.');
    console.log(`  already_ready: ${alreadyReady}`);
    console.log(`  mux_post_requests: ${posted}`);
    console.log(`  db_metadata_updates: ${dbWrites}`);
    console.log(`  errors: ${errors}`);
  } finally {
    await app.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
