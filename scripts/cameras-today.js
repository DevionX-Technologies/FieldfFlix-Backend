#!/usr/bin/env node
/**
 * cameras-today.js — incident triage for "no recordings worked today".
 *
 * Connects to the production Postgres using the same DB_* env vars the
 * backend reads at boot, then prints:
 *
 *   1. Fleet-wide status totals for the current day.
 *   2. Per-camera breakdown (venue · court · camera) grouped by status,
 *      with the most recent failed recording per camera shown alongside
 *      its raspberryPiRecordingId so you can jump straight to Pi logs.
 *   3. The last 10 failed recordings overall, with metadata payload, for
 *      cases where the failure cause is buried in `metadata.error`.
 *
 * Usage
 * -----
 *
 *   # If DB_* are already exported in your shell:
 *   node scripts/cameras-today.js
 *
 *   # Otherwise, load them from a .env file at the repo root:
 *   node -r dotenv/config scripts/cameras-today.js
 *
 *   # Or point at a specific env file (e.g. prod credentials downloaded
 *   # into ~/.fieldflix/prod.env):
 *   DOTENV_CONFIG_PATH=~/.fieldflix/prod.env \
 *     node -r dotenv/config scripts/cameras-today.js
 *
 *   # Filter to one venue (substring, case-insensitive):
 *   node scripts/cameras-today.js --venue "TSG"
 *
 *   # Include in-flight ("in_progress") recordings in the failed-list:
 *   node scripts/cameras-today.js --include-in-progress
 *
 * The script is read-only — it does not write to the database.
 */
'use strict';

const { Client } = require('pg');

// ---------- arg parsing ----------------------------------------------------
const argv = process.argv.slice(2);
const venueFilter = (() => {
  const i = argv.indexOf('--venue');
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]).toLowerCase() : null;
})();
const includeInProgress = argv.includes('--include-in-progress');

// ---------- env validation -------------------------------------------------
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `[cameras-today] Missing required env vars: ${missing.join(', ')}\n` +
      'Tip: run with `node -r dotenv/config scripts/cameras-today.js` if you ' +
      'have them in a .env file.',
  );
  process.exit(2);
}

// RDS in production *requires* SSL — the default is now "on" so this script
// works against the deployed DB without extra env juggling. Set DB_SSL=false
// to force-disable when pointing at a local Postgres that doesn't support TLS.
const sslOn = process.env.DB_SSL !== 'false';
const client = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: sslOn ? { rejectUnauthorized: false } : undefined,
});

// ---------- pretty printers ------------------------------------------------
const ANSI = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const colorForStatus = (status) =>
  status === 'failed'
    ? ANSI.red(status)
    : status === 'completed'
      ? ANSI.green(status)
      : status === 'in_progress'
        ? ANSI.yellow(status)
        : status;

function rightPad(str, n) {
  const s = String(str ?? '');
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function printRule(width = 80) {
  console.log(ANSI.dim('-'.repeat(width)));
}

// ---------- main -----------------------------------------------------------
(async () => {
  await client.connect();
  try {
    // 1) Per-(camera, status) counts for the current day.
    const perCameraSql = `
      SELECT t.name           AS venue,
             c.court_number   AS court,
             c.name           AS camera_name,
             r."cameraId"     AS camera_id,
             r.status         AS status,
             COUNT(*)::int    AS n
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= CURRENT_DATE
    GROUP BY t.name, c.court_number, c.name, r."cameraId", r.status
    ORDER BY t.name NULLS LAST, c.court_number NULLS LAST, c.name, r.status;
    `;

    // 2) Most-recent failed recording per camera (for triage links).
    const lastFailedSql = `
      SELECT DISTINCT ON (r."cameraId")
             r."cameraId"               AS camera_id,
             r.id                       AS recording_id,
             r."raspberryPiRecordingId" AS pi_recording_id,
             r."startTime"              AS started_at,
             r.metadata                 AS metadata
        FROM recordings r
       WHERE r."startTime" >= CURRENT_DATE
         AND r.status = 'failed'
    ORDER BY r."cameraId", r."startTime" DESC;
    `;

    // 3) Fleet-wide totals.
    const totalsSql = `
      SELECT status, COUNT(*)::int AS n
        FROM recordings
       WHERE "startTime" >= CURRENT_DATE
    GROUP BY status
    ORDER BY n DESC;
    `;

    // 4) The most recent failures overall, with metadata for inspection.
    // Aliases are lowercased to match the JS field names we read below — pg
    // preserves identifier casing only when you double-quote the alias.
    const recentFailedSql = `
      SELECT r.id                       AS id,
             r."cameraId"               AS camera_id,
             r."raspberryPiRecordingId" AS pi_recording_id,
             r."startTime"              AS started_at,
             r.metadata                 AS metadata,
             c.name                     AS camera_name,
             c.court_number             AS court_number,
             t.name                     AS venue
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= CURRENT_DATE
         AND r.status ${includeInProgress ? "IN ('failed','in_progress')" : "= 'failed'"}
    ORDER BY r."startTime" DESC
       LIMIT 10;
    `;

    // Sequential awaits — a single pg Client serialises queries anyway, so
    // Promise.all just produces a deprecation warning without saving time.
    const { rows: perCamera } = await client.query(perCameraSql);
    const { rows: lastFailed } = await client.query(lastFailedSql);
    const { rows: totals } = await client.query(totalsSql);
    const { rows: recentFailed } = await client.query(recentFailedSql);

    // Optional venue substring filter (case-insensitive).
    const venueMatch = (v) =>
      !venueFilter ||
      String(v ?? '')
        .toLowerCase()
        .includes(venueFilter);

    const lastFailedByCam = new Map(lastFailed.map((r) => [r.camera_id, r]));

    // ---------- Output ----------
    console.log();
    console.log(ANSI.bold('FieldFlix — camera activity today'));
    console.log(
      ANSI.dim(`as of ${new Date().toISOString()} (DB CURRENT_DATE window)`),
    );
    if (venueFilter) console.log(ANSI.dim(`venue filter: "${venueFilter}"`));
    console.log();

    // Fleet totals
    console.log(ANSI.bold('Fleet totals'));
    printRule(40);
    if (totals.length === 0) {
      console.log(ANSI.dim('  (no recordings today)'));
    } else {
      for (const t of totals) {
        console.log(`  ${colorForStatus(rightPad(t.status, 14))} ${t.n}`);
      }
    }
    console.log();

    // Per-camera table
    console.log(ANSI.bold('Per-camera breakdown'));
    printRule(120);
    console.log(
      ANSI.bold(
        `  ${rightPad('Venue', 28)} ${rightPad('Court', 6)} ${rightPad('Camera', 16)} ` +
          `${rightPad('Status', 14)} ${rightPad('Count', 7)} Last failure`,
      ),
    );
    printRule(120);

    // Group rows by (venue, court, camera_name, camera_id) so we can show the
    // failure link only on the first row of each camera.
    const grouped = new Map();
    for (const r of perCamera) {
      if (!venueMatch(r.venue)) continue;
      const k = `${r.venue ?? ''}|${r.court ?? ''}|${r.camera_name ?? ''}|${r.camera_id ?? ''}`;
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(r);
    }
    if (grouped.size === 0) {
      console.log(ANSI.dim('  (no rows match)'));
    }
    for (const [, statusRows] of grouped) {
      const first = statusRows[0];
      const fail = lastFailedByCam.get(first.camera_id);
      const failBlurb = (() => {
        if (!fail) return '';
        const d = fail.started_at ? new Date(fail.started_at) : null;
        const ts =
          d && !Number.isNaN(d.getTime())
            ? d.toISOString().slice(11, 19) + 'Z'
            : '?';
        return `${ts}  pi=${fail.pi_recording_id ?? '?'}`;
      })();
      // First row carries the venue/court/camera columns; subsequent
      // status rows for the same camera show only status+count for
      // readability.
      statusRows.forEach((row, i) => {
        const venue = i === 0 ? (row.venue ?? ANSI.dim('—')) : '';
        const court = i === 0 ? (row.court ?? '') : '';
        const cam = i === 0 ? (row.camera_name ?? ANSI.dim('—')) : '';
        const tail = i === 0 ? failBlurb : '';
        console.log(
          `  ${rightPad(venue, 28)} ${rightPad(court, 6)} ${rightPad(cam, 16)} ` +
            `${colorForStatus(rightPad(row.status, 14))} ${rightPad(row.n, 7)} ${ANSI.dim(tail)}`,
        );
      });
    }
    console.log();

    // Recent failures with metadata
    if (recentFailed.length > 0) {
      console.log(
        ANSI.bold(
          `Recent failures ${includeInProgress ? '+ in-progress' : ''} (up to 10)`,
        ),
      );
      printRule(120);
      for (const f of recentFailed) {
        if (!venueMatch(f.venue)) continue;
        const meta =
          f.metadata && typeof f.metadata === 'object'
            ? JSON.stringify(f.metadata).slice(0, 110)
            : '';
        // started_at can be a Date (pg returns Date objects for timestamp
        // columns) or a string; defend against both, and never blow up on
        // a missing value.
        const d = f.started_at ? new Date(f.started_at) : null;
        const t =
          d && !Number.isNaN(d.getTime())
            ? d.toISOString().replace('T', ' ').slice(0, 19)
            : '?';
        console.log(
          `  ${ANSI.dim(t)}  ${ANSI.yellow(rightPad(f.venue ?? '—', 26))} court ${rightPad(f.court_number ?? '?', 2)}  ` +
            `rec=${ANSI.cyan(f.id.slice(0, 8))}  pi=${ANSI.cyan(String(f.pi_recording_id ?? '?').slice(0, 12))}`,
        );
        if (meta) console.log(`        ${ANSI.dim('metadata:')} ${meta}`);
      }
      console.log();
    }

    // Hint footer
    console.log(
      ANSI.dim(
        'Tip: a fleet-wide "all failed today, zero completed" pattern usually ' +
          'means a single Pi cluster went offline. Filter by --venue to confirm.',
      ),
    );
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('[cameras-today] failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
