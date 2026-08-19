#!/usr/bin/env node
/**
 * failures-window.js — pinpoint recording-failure patterns over a multi-day
 * window using ONLY the production database. No CloudWatch, no AWS access
 * required.
 *
 * The Pi `error.message` strings live in CloudWatch and are not in the DB.
 * But the DB has enough signal — per-camera success rates, per-hour
 * histograms, and shared raspberryPiBaseUrl groupings — to answer most of
 * the "what is broken and where" question without log access.
 *
 * What it prints
 * --------------
 *
 *   1. Fleet totals for the window (failed / completed / ready / in_progress).
 *   2. Per-camera summary: total, success, failed, FAILURE RATE, first &
 *      last failure timestamps, and the Pi URL the camera is configured for.
 *      Sorted by failure rate descending so the worst offenders are on top.
 *   3. Per-Pi-URL grouping: cameras that share a raspberryPiBaseUrl get
 *      aggregated, so a single venue's router going down shows up as one
 *      hot row even when it spans multiple cameras.
 *   4. Hourly failure histogram for the window so you can eyeball whether
 *      the failures cluster at specific times (network rush, scheduled
 *      maintenance, business-hour spikes) or are spread out.
 *   5. Detailed list of the most recent failed recordings with the camera’s
 *      raspberryPiBaseUrl so you can manually curl the Pi from inside the
 *      VPC if needed.
 *
 * Usage
 * -----
 *
 *   # Default: past 3 days.
 *   node -r dotenv/config scripts/failures-window.js
 *
 *   # Custom window:
 *   node -r dotenv/config scripts/failures-window.js --days 7
 *
 *   # Filter to one venue:
 *   node -r dotenv/config scripts/failures-window.js --venue "TSG Padel"
 *
 *   # Show full failure list (default truncates at 30):
 *   node -r dotenv/config scripts/failures-window.js --all-failures
 *
 * Same DB_* env vars as cameras-today.js. SSL is on by default for RDS.
 */
'use strict';

const { Client } = require('pg');

// ---------- arg parsing ----------------------------------------------------
const argv = process.argv.slice(2);
function arg(flag, def = null) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const days = Math.max(1, parseInt(arg('--days', '3'), 10) || 3);
const venueFilter = (() => {
  const v = arg('--venue');
  return v ? String(v).toLowerCase() : null;
})();
const showAllFailures = argv.includes('--all-failures');

// ---------- env validation -------------------------------------------------
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `[failures-window] Missing required env vars: ${missing.join(', ')}\n` +
      'Run with `node -r dotenv/config scripts/failures-window.js` if you have a .env file.',
  );
  process.exit(2);
}

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
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
};
const rightPad = (s, n) => {
  const str = String(s ?? '');
  if (str.length >= n) return str.slice(0, n);
  return str + ' '.repeat(n - str.length);
};
const rule = (w = 120) => console.log(ANSI.dim('-'.repeat(w)));
const fmtPct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const colorRate = (pct) =>
  pct >= 60
    ? ANSI.red(rightPad(`${pct}%`, 6))
    : pct >= 25
      ? ANSI.yellow(rightPad(`${pct}%`, 6))
      : ANSI.green(rightPad(`${pct}%`, 6));

// ---------- main -----------------------------------------------------------
(async () => {
  await client.connect();
  try {
    const interval = `${days} days`;
    const venueWhere = venueFilter
      ? `AND LOWER(COALESCE(t.name,'')) LIKE $1`
      : '';
    const venueArgs = venueFilter ? [`%${venueFilter}%`] : [];

    // -------------------- 1) Fleet totals -----------------------------------
    const totalsSql = `
      SELECT r.status, COUNT(*)::int AS n
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= NOW() - INTERVAL '${interval}'
       ${venueWhere}
    GROUP BY r.status
    ORDER BY n DESC;
    `;
    const { rows: totals } = await client.query(totalsSql, venueArgs);

    // -------------------- 2) Per-camera summary -----------------------------
    const perCameraSql = `
      SELECT t.name           AS venue,
             c.court_number   AS court,
             c.name           AS camera_name,
             r."cameraId"     AS camera_id,
             c."raspberryPiBaseUrl" AS pi_url,
             COUNT(*) FILTER (WHERE r.status = 'failed')::int                       AS failed,
             COUNT(*) FILTER (WHERE r.status IN ('completed','ready'))::int         AS success,
             COUNT(*)::int                                                          AS total,
             MIN(r."startTime") FILTER (WHERE r.status = 'failed')                  AS first_failure,
             MAX(r."startTime") FILTER (WHERE r.status = 'failed')                  AS last_failure
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= NOW() - INTERVAL '${interval}'
       ${venueWhere}
    GROUP BY t.name, c.court_number, c.name, r."cameraId", c."raspberryPiBaseUrl"
    ORDER BY failed DESC, total DESC;
    `;
    const { rows: perCamera } = await client.query(perCameraSql, venueArgs);

    // -------------------- 3) Per-Pi-URL aggregation -------------------------
    const perPiUrlSql = `
      SELECT c."raspberryPiBaseUrl"                                            AS pi_url,
             COUNT(DISTINCT c.id)::int                                          AS camera_count,
             COUNT(*) FILTER (WHERE r.status = 'failed')::int                   AS failed,
             COUNT(*)::int                                                      AS total
        FROM recordings r
        JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= NOW() - INTERVAL '${interval}'
       ${venueWhere}
    GROUP BY c."raspberryPiBaseUrl"
      HAVING COUNT(*) FILTER (WHERE r.status = 'failed') > 0
    ORDER BY failed DESC;
    `;
    const { rows: perPiUrl } = await client.query(perPiUrlSql, venueArgs);

    // -------------------- 4) Hourly histogram of failures -------------------
    const histSql = `
      SELECT DATE_TRUNC('hour', r."startTime") AS hour,
             COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
             COUNT(*)::int                                    AS total
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= NOW() - INTERVAL '${interval}'
       ${venueWhere}
    GROUP BY hour
      HAVING COUNT(*) > 0
    ORDER BY hour ASC;
    `;
    const { rows: hist } = await client.query(histSql, venueArgs);

    // -------------------- 5) Recent failed recordings -----------------------
    const failuresSql = `
      SELECT r.id                       AS recording_id,
             r."startTime"              AS started_at,
             r."endTime"                AS ended_at,
             r."raspberryPiRecordingId" AS pi_recording_id,
             r.metadata                 AS metadata,
             c.name                     AS camera_name,
             c.court_number             AS court,
             c."raspberryPiBaseUrl"     AS pi_url,
             t.name                     AS venue
        FROM recordings r
   LEFT JOIN cameras c ON c.id = r."cameraId"
   LEFT JOIN turfs   t ON t.id = c."turfId"
       WHERE r."startTime" >= NOW() - INTERVAL '${interval}'
         AND r.status = 'failed'
         ${venueWhere}
    ORDER BY r."startTime" DESC
       LIMIT ${showAllFailures ? 500 : 30};
    `;
    const { rows: failures } = await client.query(failuresSql, venueArgs);

    // ----------------------------- OUTPUT -----------------------------------
    console.log();
    console.log(
      ANSI.bold(
        `FieldFlicks - recording-failure window analysis (past ${days} day${days === 1 ? '' : 's'})`,
      ),
    );
    console.log(ANSI.dim(`as of ${new Date().toISOString()}`));
    if (venueFilter) console.log(ANSI.dim(`venue filter: "${venueFilter}"`));
    console.log();

    // 1) Fleet totals
    console.log(ANSI.bold('1. Fleet totals'));
    rule(40);
    if (totals.length === 0) {
      console.log(ANSI.dim('  (no recordings in window)'));
    } else {
      const totalRecs = totals.reduce((s, r) => s + r.n, 0);
      for (const t of totals) {
        const pct = fmtPct(t.n, totalRecs);
        const col =
          t.status === 'failed'
            ? ANSI.red
            : t.status === 'completed' || t.status === 'ready'
              ? ANSI.green
              : ANSI.yellow;
        console.log(
          `  ${col(rightPad(t.status, 14))} ${rightPad(t.n, 6)} ${ANSI.dim('(' + pct + ')')}`,
        );
      }
    }
    console.log();

    // 2) Per-camera summary
    console.log(ANSI.bold('2. Per-camera breakdown (sorted by failure count)'));
    rule(140);
    console.log(
      ANSI.bold(
        `  ${rightPad('Venue', 26)} ${rightPad('Court', 6)} ${rightPad('Camera', 14)} ` +
          `${rightPad('Total', 7)} ${rightPad('OK', 6)} ${rightPad('Fail', 6)} ${rightPad('Rate', 7)} ` +
          `${rightPad('Last failure', 20)} Pi URL`,
      ),
    );
    rule(140);
    for (const r of perCamera) {
      const rate = r.total ? Math.round((r.failed / r.total) * 100) : 0;
      const last = r.last_failure
        ? new Date(r.last_failure).toISOString().replace('T', ' ').slice(0, 19)
        : '—';
      const url = (r.pi_url ?? '—').replace(/^https?:\/\//, '').slice(0, 32);
      console.log(
        `  ${rightPad(r.venue ?? '—', 26)} ${rightPad(r.court ?? '?', 6)} ${rightPad(r.camera_name ?? '—', 14)} ` +
          `${rightPad(r.total, 7)} ${ANSI.green(rightPad(r.success, 6))} ${ANSI.red(rightPad(r.failed, 6))} ${colorRate(rate)} ` +
          `${ANSI.dim(rightPad(last, 20))} ${ANSI.cyan(url)}`,
      );
    }
    console.log();

    // 3) Per-Pi-URL aggregation — groups cameras behind the same Pi/router
    if (perPiUrl.length > 0) {
      console.log(
        ANSI.bold(
          '3. Failures grouped by Pi URL (camera count, total, failed)',
        ),
      );
      console.log(
        ANSI.dim(
          '   Cameras sharing the same raspberryPiBaseUrl typically sit behind ' +
            'the same router. A URL with high failures across multiple cameras ' +
            'points at venue infrastructure rather than a single Pi.',
        ),
      );
      rule(140);
      console.log(
        ANSI.bold(
          `  ${rightPad('Pi URL', 50)} ${rightPad('Cameras', 9)} ${rightPad('Total', 7)} ${rightPad('Failed', 7)} Rate`,
        ),
      );
      rule(140);
      for (const r of perPiUrl) {
        const rate = r.total ? Math.round((r.failed / r.total) * 100) : 0;
        const url = (r.pi_url ?? '—').slice(0, 50);
        console.log(
          `  ${ANSI.cyan(rightPad(url, 50))} ${rightPad(r.camera_count, 9)} ${rightPad(r.total, 7)} ${ANSI.red(rightPad(r.failed, 7))} ${colorRate(rate)}`,
        );
      }
      console.log();
    }

    // 4) Hourly histogram (compact ASCII bars)
    if (hist.length > 0) {
      console.log(ANSI.bold('4. Hourly failure histogram'));
      console.log(
        ANSI.dim(
          '   Look for clustering — e.g. every weekday 9–11 AM = predictable ' +
            'venue network congestion; sporadic = transient Pi crashes; ' +
            'continuous = persistent outage.',
        ),
      );
      rule(140);
      const maxFails = Math.max(1, ...hist.map((h) => h.failed));
      for (const h of hist) {
        const ts = new Date(h.hour)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 13);
        const barWidth = Math.round((h.failed / maxFails) * 50);
        const bar = h.failed ? ANSI.red('█'.repeat(barWidth)) : ANSI.dim('·');
        console.log(
          `  ${ANSI.dim(rightPad(ts, 14))} ${rightPad(`fail=${h.failed}`, 10)} ${rightPad(`total=${h.total}`, 12)} ${bar}`,
        );
      }
      console.log();
    }

    // 5) Detail of failures
    if (failures.length > 0) {
      console.log(
        ANSI.bold(
          `5. Failed recordings detail (${failures.length}${showAllFailures ? '' : ', truncated to 30; pass --all-failures for everything'})`,
        ),
      );
      rule(140);
      for (const f of failures) {
        const t = f.started_at
          ? new Date(f.started_at).toISOString().replace('T', ' ').slice(0, 19)
          : '?';
        const url = (f.pi_url ?? '—').replace(/^https?:\/\//, '').slice(0, 30);
        const dur =
          f.started_at && f.ended_at
            ? Math.round(
                (new Date(f.ended_at).getTime() -
                  new Date(f.started_at).getTime()) /
                  1000,
              )
            : null;
        console.log(
          `  ${ANSI.dim(rightPad(t, 20))} ${ANSI.yellow(rightPad(f.venue ?? '—', 24))} ct=${rightPad(f.court ?? '?', 2)} ` +
            `cam=${rightPad(f.camera_name ?? '—', 12)} rec=${ANSI.cyan(f.recording_id.slice(0, 8))} ` +
            `pi_rec=${ANSI.cyan(String(f.pi_recording_id ?? '—').slice(0, 12))} ` +
            `dur=${dur != null ? rightPad(dur + 's', 6) : ANSI.dim('?    ')} url=${ANSI.cyan(url)}`,
        );
      }
      console.log();
    }

    // ----------------------------- INTERPRETATION ---------------------------
    console.log(ANSI.bold('Interpretation guide'));
    rule(140);
    console.log(
      ANSI.dim(
        '  • A camera at 100% failure rate is hard-down. Check its Pi power / ' +
          'network at the venue, or whether raspberryPiBaseUrl has drifted from ' +
          'the actual Pi IP.\n' +
          '  • A camera at 30-70% failure rate is flapping — usually intermittent ' +
          'Wi-Fi or a Pi that crashes and restarts.\n' +
          '  • If multiple cameras with the SAME Pi URL fail together, the venue ' +
          'router or the shared Pi cluster is the suspect — not the cameras.\n' +
          '  • If failures cluster at specific hours, look at venue activity ' +
          '(peak Wi-Fi load) or scheduled processes on the Pi.\n' +
          '  • A recording with status=failed but pi_recording_id=— means the ' +
          'START call to the Pi failed (the recording never began). With a ' +
          'pi_recording_id present, the START succeeded but STOP failed (the ' +
          'recording is probably still on the Pi, just orphaned).',
      ),
    );
    console.log();
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('[failures-window] failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
