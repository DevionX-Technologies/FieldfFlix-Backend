#!/usr/bin/env node
/**
 * recover-apply.js — actually recover failed recordings whose video files
 * we already found in S3 via recover-check.js.
 *
 * Two steps per recording:
 *   1) UPDATE the row to `status='completed', "s3Path"='<key>'`.
 *   2) POST to the backend's `/mux/upload` endpoint so the existing Mux
 *      pipeline ingests the file and the recording becomes playable.
 *
 * DRY-RUN BY DEFAULT. Nothing happens until you pass `--apply`. The dry
 * run prints exactly what it would do so you can sanity-check before
 * touching production rows.
 *
 * Usage
 * -----
 *
 *   # Dry-run for the past 7 days (re-runs the recovery scan first):
 *   node -r dotenv/config scripts/recover-apply.js --days 7
 *
 *   # Apply for real (DB update + Mux trigger):
 *   node -r dotenv/config scripts/recover-apply.js --days 7 --apply
 *
 *   # Apply only to one specific recording:
 *   node -r dotenv/config scripts/recover-apply.js \
 *     --recording-id 75c97c38-... --apply
 *
 *   # Apply just the DB update, skip the Mux trigger (e.g. if you want to
 *   # batch the Mux requests yourself afterwards):
 *   node -r dotenv/config scripts/recover-apply.js --days 7 --apply --no-mux
 *
 * Required env (in .env or shell):
 *
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE   — production DB
 *   AWS_REGION                                   — defaults to ap-south-1
 *   AWS_S3_RECORDINGS_BUCKET                     — defaults to bucket flag
 *   API_BASE_URL                                 — e.g. https://api.fieldflicks.example.com
 *   LAMBDA_API_KEY                               — same value the backend reads
 *                                                  (matches the `x-api-key` it expects)
 *   MUX_PRESIGN_TTL_SEC                          — presigned URL TTL (default 3600)
 *
 * The script is structured so the dry-run phase makes ZERO writes — no DB
 * UPDATE, no HTTP POST to the backend. Only `--apply` flips that.
 */
'use strict';

const { Client } = require('pg');
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ---------- arg parsing ----------------------------------------------------
const argv = process.argv.slice(2);
function arg(flag, def = null) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
function multiArg(flag) {
  const out = [];
  let i = -1;
  while ((i = argv.indexOf(flag, i + 1)) !== -1) {
    if (argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}
const apply = argv.includes('--apply');
const skipMux = argv.includes('--no-mux');
const days = Math.max(1, parseInt(arg('--days', '7'), 10) || 7);
const explicitIds = multiArg('--recording-id');
const bucket = arg('--bucket', process.env.AWS_S3_RECORDINGS_BUCKET);
const prefix = arg('--prefix', 'recordings/');
const region = arg('--region', process.env.AWS_REGION || 'ap-south-1');
const apiBase = (arg('--api-url', process.env.API_BASE_URL) || '').replace(
  /\/$/,
  '',
);
const apiKey = process.env.LAMBDA_API_KEY;
const presignTtlSec = parseInt(process.env.MUX_PRESIGN_TTL_SEC || '3600', 10);

// ---------- validation -----------------------------------------------------
if (!bucket) {
  console.error(
    '[recover-apply] Bucket required. Pass --bucket <name> or set\n' +
      'AWS_S3_RECORDINGS_BUCKET in your .env.',
  );
  process.exit(2);
}
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `[recover-apply] Missing DB env vars: ${missing.join(', ')}. Run with\n` +
      '`node -r dotenv/config scripts/recover-apply.js`.',
  );
  process.exit(2);
}
if (apply && !skipMux) {
  if (!apiBase) {
    console.error(
      '[recover-apply] --apply needs API_BASE_URL (or --api-url <url>) for the\n' +
        'Mux trigger step. Pass --no-mux to skip the Mux step and only do the\n' +
        'DB update.',
    );
    process.exit(2);
  }
  if (!apiKey) {
    console.error(
      '[recover-apply] --apply needs LAMBDA_API_KEY in env so the script can\n' +
        'authenticate to /mux/upload. Pass --no-mux to skip the Mux step.',
    );
    process.exit(2);
  }
}

// ---------- clients --------------------------------------------------------
const sslOn = process.env.DB_SSL !== 'false';
const pg = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: sslOn ? { rejectUnauthorized: false } : undefined,
});
const s3 = new S3Client({ region });

// ---------- pretty ---------------------------------------------------------
const ANSI = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ---------- helpers --------------------------------------------------------

/**
 * Find the S3 key for one recording. Uses the same targeted-prefix lookup
 * as recover-check.js — typically one API call.
 */
async function findS3Key(piRecordingId) {
  const out = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${prefix}${piRecordingId}`,
      MaxKeys: 10,
    }),
  );
  for (const obj of out.Contents || []) {
    if (obj.Key && obj.Key.includes(piRecordingId)) {
      return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified };
    }
  }
  return null;
}

/**
 * Generate a presigned GET URL for the Mux service to fetch the video.
 * Mux needs a publicly-reachable URL; presigned URLs are the standard way
 * to grant time-limited access without making the bucket public.
 */
async function presignGet(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: presignTtlSec,
  });
}

/**
 * Locate candidate rows. Two modes:
 *   - explicit --recording-id <uuid> args
 *   - auto-discover: failed rows in past `days` with a pi_recording_id
 */
async function loadCandidates() {
  if (explicitIds.length > 0) {
    const { rows } = await pg.query(
      `SELECT r.id, r.status, r."s3Path", r."raspberryPiRecordingId" AS pi_id,
              c.name AS camera_name, c.court_number AS court,
              t.name AS venue
         FROM recordings r
    LEFT JOIN cameras c ON c.id = r."cameraId"
    LEFT JOIN turfs   t ON t.id = c."turfId"
        WHERE r.id = ANY($1::uuid[])`,
      [explicitIds],
    );
    return rows;
  }
  const { rows } = await pg.query(
    `SELECT r.id, r.status, r."s3Path", r."raspberryPiRecordingId" AS pi_id,
            c.name AS camera_name, c.court_number AS court,
            t.name AS venue
       FROM recordings r
  LEFT JOIN cameras c ON c.id = r."cameraId"
  LEFT JOIN turfs   t ON t.id = c."turfId"
      WHERE r."startTime" >= NOW() - INTERVAL '${days} days'
        AND r.status = 'failed'
        AND r."raspberryPiRecordingId" IS NOT NULL
   ORDER BY r."startTime" DESC`,
  );
  return rows;
}

async function applyDbUpdate(recordingId, s3Key) {
  // Pre-check the row is actually still in the state we expect. A defensive
  // WHERE clause ensures we never overwrite a row that was completed by some
  // other path between dry-run and apply.
  const res = await pg.query(
    `UPDATE recordings
        SET status = 'completed',
            "s3Path" = $2,
            "endTime" = COALESCE("endTime", NOW())
      WHERE id = $1
        AND status = 'failed'
        AND "s3Path" IS NULL
      RETURNING id, status, "s3Path"`,
    [recordingId, s3Key],
  );
  return res.rows[0] ?? null;
}

async function triggerMux(recordingId, s3Key, s3Url) {
  // Native fetch (Node 18+). The endpoint returns 202 with a JSON body.
  const res = await fetch(`${apiBase}/mux/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ recordingId, key: s3Key, s3Url }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /mux/upload ${res.status}: ${text}`);
  }
  return text;
}

// ---------- main -----------------------------------------------------------
(async () => {
  await pg.connect();
  try {
    const mode = apply ? 'APPLY' : 'DRY-RUN';
    console.log();
    console.log(
      ANSI.bold(`recover-apply — ${mode}`) +
        (skipMux ? ANSI.dim(' (Mux trigger SKIPPED)') : ''),
    );
    console.log(
      ANSI.dim(`bucket=s3://${bucket}/${prefix}    region=${region}`),
    );
    if (!apply) {
      console.log(
        ANSI.yellow(
          'No changes will be made. Re-run with --apply to actually update and trigger Mux.',
        ),
      );
    }
    console.log();

    const candidates = await loadCandidates();
    if (candidates.length === 0) {
      console.log(ANSI.dim('No candidate rows found.'));
      return;
    }

    let recoverable = 0;
    let notFound = 0;
    let skipped = 0;
    let appliedDb = 0;
    let appliedMux = 0;
    let muxErrors = 0;

    for (const row of candidates) {
      if (!row.pi_id) {
        skipped++;
        console.log(
          `  ${ANSI.dim(rightPad8(row.id))}  ${ANSI.dim('SKIP no pi_recording_id')}`,
        );
        continue;
      }
      if (row.status !== 'failed' || row.s3Path) {
        skipped++;
        console.log(
          `  ${ANSI.dim(rightPad8(row.id))}  ${ANSI.dim(`SKIP status=${row.status} s3Path=${row.s3Path ? 'set' : 'null'}`)}`,
        );
        continue;
      }
      const hit = await findS3Key(row.pi_id);
      if (!hit) {
        notFound++;
        console.log(
          `  ${ANSI.dim(rightPad8(row.id))}  ${ANSI.red('NOT IN S3')}  pi=${ANSI.cyan(row.pi_id.slice(0, 12))}`,
        );
        continue;
      }

      recoverable++;
      const venueLabel = `${row.venue ?? '—'} ct${row.court ?? '?'} cam=${row.camera_name ?? '—'}`;
      console.log(
        `  ${ANSI.cyan(rightPad8(row.id))}  ${ANSI.green('RECOVERABLE')}  ` +
          `${ANSI.dim(venueLabel)}`,
      );
      console.log(
        `    ${ANSI.dim('s3Key:    ')}${ANSI.cyan(hit.key)} ${ANSI.dim(`(${Math.round((hit.size || 0) / 1024)} KB)`)}`,
      );

      if (!apply) {
        console.log(
          `    ${ANSI.dim('would-do:')} UPDATE recordings SET status='completed', "s3Path"=$1 WHERE id=$2`,
        );
        if (!skipMux) {
          console.log(
            `    ${ANSI.dim('would-do:')} POST ${apiBase || '<API_BASE_URL not set>'}/mux/upload (presigned URL, key, recordingId)`,
          );
        }
        continue;
      }

      // ---- DB update ----
      try {
        const updated = await applyDbUpdate(row.id, hit.key);
        if (!updated) {
          console.log(
            `    ${ANSI.yellow('skipped DB update')} (row no longer matches status=failed AND s3Path IS NULL — concurrent change?)`,
          );
          continue;
        }
        appliedDb++;
        console.log(
          `    ${ANSI.green('DB updated')} → status=completed, s3Path=${ANSI.cyan(updated.s3Path)}`,
        );
      } catch (e) {
        console.log(`    ${ANSI.red('DB update failed')}: ${e.message}`);
        continue;
      }

      // ---- Mux trigger ----
      if (skipMux) {
        console.log(`    ${ANSI.dim('Mux trigger skipped (--no-mux)')}`);
        continue;
      }
      try {
        const url = await presignGet(hit.key);
        const out = await triggerMux(row.id, hit.key, url);
        appliedMux++;
        console.log(
          `    ${ANSI.green('Mux upload triggered')} → ${ANSI.dim(out.slice(0, 80))}`,
        );
      } catch (e) {
        muxErrors++;
        console.log(`    ${ANSI.red('Mux trigger failed')}: ${e.message}`);
        console.log(
          `    ${ANSI.dim('row was already updated; retry Mux later with --recording-id ' + row.id)}`,
        );
      }
    }

    console.log();
    console.log(ANSI.bold('Summary'));
    console.log(ANSI.dim('-'.repeat(80)));
    console.log(
      `  candidates: ${candidates.length}  ` +
        `${ANSI.green(`recoverable: ${recoverable}`)}  ` +
        `${ANSI.red(`not-in-s3: ${notFound}`)}  ` +
        `${ANSI.dim(`skipped: ${skipped}`)}`,
    );
    if (apply) {
      console.log(
        `  applied DB updates: ${ANSI.green(appliedDb)}  ` +
          `Mux triggered: ${ANSI.green(appliedMux)}  ` +
          (muxErrors ? `${ANSI.red('Mux errors: ' + muxErrors)}` : ''),
      );
    } else {
      console.log(
        `  ${ANSI.yellow('dry-run only — pass --apply to perform the updates above')}`,
      );
    }
  } finally {
    await pg.end();
  }
})().catch((err) => {
  console.error('[recover-apply] failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

// ---------- small util -----------------------------------------------------
function rightPad8(s) {
  return String(s ?? '')
    .slice(0, 8)
    .padEnd(8);
}
