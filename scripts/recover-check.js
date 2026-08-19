#!/usr/bin/env node
/**
 * recover-check.js — for each failed recording in the past N days, look for
 * the raw video on S3 by searching for the camera's raspberryPiRecordingId
 * in the recordings bucket.
 *
 * READ-ONLY. The script makes NO database writes and NO S3 writes. It only
 * runs SELECTs and ListObjectsV2 calls so it is safe to run against
 * production at any time.
 *
 * Why this works (when it does)
 * -----------------------------
 *
 * Even when our backend's STOP call fails (Pinggy tunnel expired, network
 * drop, Pi crash), the Pi may have:
 *   a) Finished the recording locally and uploaded it to S3 via its own
 *      auto-upload routine.
 *   b) Held the file on its SD card without uploading.
 *
 * (a) is recoverable from the cloud right now. (b) requires SSH to the Pi.
 * This script checks for (a) by listing the recordings bucket and matching
 * any keys that contain the `raspberryPiRecordingId` — which is the natural
 * unique identifier the Pi would use in its S3 key.
 *
 * Usage
 * -----
 *
 *   # Default: past 3 days, bucket from $AWS_S3_RECORDINGS_BUCKET env var.
 *   node -r dotenv/config scripts/recover-check.js
 *
 *   # 7-day window:
 *   node -r dotenv/config scripts/recover-check.js --days 7
 *
 *   # Specify bucket explicitly:
 *   node -r dotenv/config scripts/recover-check.js --bucket fieldflix-recordings-prod
 *
 *   # Restrict prefix (defaults to `recordings/`):
 *   node -r dotenv/config scripts/recover-check.js --prefix video/
 *
 * Output
 * ------
 *
 *   For each failed recording:
 *     RECOVERABLE   if any S3 key contains the raspberryPiRecordingId
 *     NOT IN S3     if no matching key
 *     SKIP          if pi_recording_id is missing on the row
 *
 *   The script prints the candidate s3Key but does NOT write to the DB.
 *   You can use the printed key to manually update the row via psql:
 *
 *     UPDATE recordings
 *        SET status   = 'completed',
 *            "s3Path" = '<the-printed-key>'
 *      WHERE id = '<recording-uuid>';
 *
 *   …and then trigger the Mux upload pipeline for that recording via the
 *   existing `triggerMuxUpload` code path.
 */
'use strict';

const { Client } = require('pg');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// ---------- arg parsing ----------------------------------------------------
const argv = process.argv.slice(2);
function arg(flag, def = null) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const days = Math.max(1, parseInt(arg('--days', '3'), 10) || 3);
const bucket = arg('--bucket', process.env.AWS_S3_RECORDINGS_BUCKET);
const prefix = arg('--prefix', 'recordings/');
const region = arg('--region', process.env.AWS_REGION || 'ap-south-1');
const venueFilter = (() => {
  const v = arg('--venue');
  return v ? String(v).toLowerCase() : null;
})();

// ---------- validation -----------------------------------------------------
if (!bucket) {
  console.error(
    '[recover-check] Bucket name required. Pass --bucket <name> or set\n' +
      'AWS_S3_RECORDINGS_BUCKET in your .env. To discover it, look at the\n' +
      's3Path column of any *successful* recording in the DB — the prefix\n' +
      'before /recordings/ is the bucket. e.g. `SELECT "s3Path" FROM\n' +
      "recordings WHERE status='completed' LIMIT 1;`",
  );
  process.exit(2);
}
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `[recover-check] Missing DB env vars: ${missing.join(', ')}. Run with\n` +
      '`node -r dotenv/config scripts/recover-check.js`.',
  );
  process.exit(2);
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

// ---------- pretty -----------
const ANSI = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const rightPad = (s, n) => {
  const str = String(s ?? '');
  return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length);
};

// ---------- S3 search ------------------------------------------------------
/**
 * Targeted ListObjectsV2 — uses the raspberryPiRecordingId as part of the
 * S3 prefix so we don't scan the whole bucket. Your s3Path pattern is
 *     recordings/<raspberryPiRecordingId>_<timestamp>.mp4
 * so `recordings/<id>` is a unique prefix per recording. S3 itself filters
 * to that prefix — typically returns 0 or 1 keys with one API call.
 *
 * Falls back to a substring scan over the full `prefix/` if no key turns
 * up under the targeted prefix, in case the Pi names files differently
 * (e.g. `<id>/` directory layout).
 */
async function findS3KeyContaining(needle, opts = {}) {
  // 1) Fast targeted lookup
  const targetedPrefix = `${prefix}${needle}`;
  const targeted = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: targetedPrefix,
      MaxKeys: 50,
    }),
  );
  for (const obj of targeted.Contents || []) {
    if (obj.Key && obj.Key.includes(needle)) {
      return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified };
    }
  }
  // 2) Optional fallback: substring scan over the full prefix.
  if (!opts.fallback) return null;
  const maxPages = opts.maxPages ?? 50; // 50 pages * 1000 = 50k objects max
  let token;
  let pages = 0;
  while (pages < maxPages) {
    pages += 1;
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const obj of out.Contents || []) {
      if (obj.Key && obj.Key.includes(needle)) {
        return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified };
      }
    }
    if (!out.IsTruncated) break;
    token = out.NextContinuationToken;
  }
  return null;
}

// ---------- main -----------------------------------------------------------
(async () => {
  await pg.connect();
  try {
    const venueArgs = venueFilter ? [`%${venueFilter}%`] : [];
    const venueWhere = venueFilter
      ? `AND LOWER(COALESCE(t.name,'')) LIKE $1`
      : '';
    const { rows: failed } = await pg.query(
      `
      SELECT r.id                       AS recording_id,
             r."startTime"              AS started_at,
             r."endTime"                AS ended_at,
             r."raspberryPiRecordingId" AS pi_recording_id,
             r.status                   AS status,
             c.name                     AS camera_name,
             c.court_number             AS court,
             t.name                     AS venue
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= NOW() - INTERVAL '${days} days'
         AND r.status = 'failed'
         ${venueWhere}
    ORDER BY r."startTime" DESC
      `,
      venueArgs,
    );

    console.log();
    console.log(
      ANSI.bold(
        `Recovery check - past ${days} day(s) - ${failed.length} failed recording(s)`,
      ),
    );
    console.log(
      ANSI.dim(`bucket=s3://${bucket}/${prefix}    region=${region}`),
    );
    console.log(ANSI.dim('-'.repeat(140)));
    console.log(
      ANSI.bold(
        `  ${rightPad('Started (UTC)', 20)} ${rightPad('Venue', 26)} ` +
          `${rightPad('Ct', 4)} ${rightPad('Rec', 10)} ${rightPad('Status', 14)} S3 key (if recoverable)`,
      ),
    );
    console.log(ANSI.dim('-'.repeat(140)));

    let recoverable = 0;
    let notInS3 = 0;
    let skipped = 0;

    for (const f of failed) {
      const t = f.started_at
        ? new Date(f.started_at).toISOString().replace('T', ' ').slice(0, 19)
        : '?';
      const baseLine =
        `  ${ANSI.dim(rightPad(t, 20))} ${ANSI.yellow(rightPad(f.venue ?? '—', 26))} ` +
        `${rightPad(f.court ?? '?', 4)} ${ANSI.cyan(rightPad(String(f.recording_id).slice(0, 8), 10))} `;

      if (!f.pi_recording_id) {
        skipped += 1;
        console.log(
          baseLine +
            `${ANSI.dim(rightPad('SKIP', 14))} ${ANSI.dim('no pi_recording_id')}`,
        );
        continue;
      }

      try {
        const hit = await findS3KeyContaining(String(f.pi_recording_id));
        if (hit) {
          recoverable += 1;
          const sizeKb = hit.size ? Math.round(hit.size / 1024) : '?';
          console.log(
            baseLine +
              `${ANSI.green(rightPad('RECOVERABLE', 14))} ` +
              `${ANSI.cyan(hit.key)}  ${ANSI.dim(`(${sizeKb} KB)`)}`,
          );
        } else {
          notInS3 += 1;
          console.log(
            baseLine +
              `${ANSI.red(rightPad('NOT IN S3', 14))} ${ANSI.dim('pi=' + String(f.pi_recording_id).slice(0, 12))}`,
          );
        }
      } catch (err) {
        console.log(
          baseLine +
            `${ANSI.red(rightPad('ERROR', 14))} ${ANSI.dim(err.message)}`,
        );
      }
    }

    console.log(ANSI.dim('-'.repeat(140)));
    console.log(
      `Summary: ${ANSI.green(`${recoverable} recoverable`)} | ` +
        `${ANSI.red(`${notInS3} not in S3`)} | ` +
        `${ANSI.dim(`${skipped} skipped`)}`,
    );
    console.log();
    if (recoverable > 0) {
      console.log(ANSI.bold('How to actually recover a row'));
      console.log(ANSI.dim('-'.repeat(140)));
      console.log(
        ANSI.dim(
          '  This script did NOT modify anything. To complete recovery for a row,\n' +
            '  use the printed s3Key with a manual SQL update:\n' +
            "    UPDATE recordings SET status='completed', \"s3Path\"='<key>'\n" +
            "      WHERE id='<recording-uuid>';\n" +
            '  Then trigger Mux upload for the recording via the existing\n' +
            '  `triggerMuxUpload` path so the video becomes playable.',
        ),
      );
    } else if (notInS3 > 0) {
      console.log(
        ANSI.dim(
          'No matching S3 keys. Either the Pi did not auto-upload (check the\n' +
            'Pi-side recorder for an auto-finalize routine), or the file is\n' +
            'still on the Pi SD card. SSH into the Pi to confirm and pull\n' +
            'the file manually.',
        ),
      );
    }
  } finally {
    await pg.end();
  }
})().catch((err) => {
  console.error('[recover-check] failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
