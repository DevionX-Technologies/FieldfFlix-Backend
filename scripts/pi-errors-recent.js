#!/usr/bin/env node
/**
 * pi-errors-recent.js — fetch Raspberry Pi failure messages from CloudWatch
 * Logs for the past N days, joined to recording rows so each error line
 * carries venue / court / camera context.
 *
 * Why this exists
 * ---------------
 *
 * The backend's `recording.service.ts` logs the actual upstream error from
 * the Pi at line 485:
 *
 *     Attempt N to stop recording on Raspberry Pi failed. Retrying in {ms}ms: {error.message}
 *
 * …but never persists it to the DB. CloudWatch is therefore the only place
 * the error string lives. This script runs a Logs Insights query against the
 * deployed ECS log group, pulls the matching lines from the requested
 * window, and prints them grouped by recording id so duplicate retries
 * collapse into one diagnostic row per failure.
 *
 * Usage
 * -----
 *
 *   # Default: past 3 days, ECS log group, ap-south-1.
 *   node scripts/pi-errors-recent.js
 *
 *   # Custom window:
 *   node scripts/pi-errors-recent.js --days 7
 *
 *   # Custom log group:
 *   node scripts/pi-errors-recent.js --log-group /ecs/fieldflicks-prod
 *
 *   # Filter to a venue (resolved via the recordings + cameras join):
 *   node -r dotenv/config scripts/pi-errors-recent.js --venue "TSG Padel"
 *
 *   # JSON dump for piping into jq:
 *   node scripts/pi-errors-recent.js --json
 *
 * Requirements
 * ------------
 *
 *   - AWS credentials picked up from the default chain (env vars, ~/.aws,
 *     SSO, EC2/ECS role). Run `aws configure` once if you haven't, OR set
 *     AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / (optional) AWS_SESSION_TOKEN.
 *     The credentials need `logs:StartQuery` + `logs:GetQueryResults` on
 *     the target log group.
 *   - DB_* env vars (only required if you want venue/court context joined
 *     onto the rows — without them the script still prints raw log lines).
 *
 * The script is read-only — no DB writes, no log writes.
 */
'use strict';

const {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

// ---------- arg parsing ----------------------------------------------------
const argv = process.argv.slice(2);
function arg(flag, def = null) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const days = Math.max(1, parseInt(arg('--days', '3'), 10) || 3);
const logGroup = arg(
  '--log-group',
  process.env.AWS_CW_LOG_GROUP || '/ecs/devionx-fieldflix-backend',
);
const region = arg('--region', process.env.AWS_REGION || 'ap-south-1');
const venueFilter = (() => {
  const v = arg('--venue');
  return v ? String(v).toLowerCase() : null;
})();
const asJson = argv.includes('--json');

// ---------- SDK client (no CLI dependency) --------------------------------
const cw = new CloudWatchLogsClient({ region });

// ---------- Run Logs Insights query ---------------------------------------
async function runQuery() {
  const now = Math.floor(Date.now() / 1000);
  const startSec = now - days * 24 * 3600;

  // Two patterns we care about:
  //   1. "Attempt N to stop recording on Raspberry Pi failed" — direct upstream
  //   2. "Error in background stop recording processing for" — wrapper
  //
  // @logStream tells you which ECS task emitted the line, which helps
  // distinguish a Pi-side spike from a backend restart.
  const queryString = `
    fields @timestamp, @message, @logStream
    | filter @message like /stop recording on Raspberry Pi failed/
        or @message like /Error in background stop recording processing for/
    | sort @timestamp desc
    | limit 1000
  `
    .replace(/\s+/g, ' ')
    .trim();

  let queryId;
  try {
    const out = await cw.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime: startSec,
        endTime: now,
        queryString,
        limit: 1000,
      }),
    );
    queryId = out.queryId;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      throw new Error(
        `Log group not found: "${logGroup}". List available groups with:\n` +
          `  aws logs describe-log-groups --region ${region} --query 'logGroups[].logGroupName'\n` +
          `…then re-run with --log-group <name>.`,
      );
    }
    if (
      err.name === 'CredentialsProviderError' ||
      err.name === 'UnrecognizedClientException'
    ) {
      throw new Error(
        'AWS credentials not found or invalid. Either run `aws configure` once, ' +
          'or export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY before running.',
      );
    }
    throw err;
  }

  // Poll for completion. Insights queries usually finish in <5s for this
  // volume; we cap the wait at ~60s.
  let result;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await cw.send(new GetQueryResultsCommand({ queryId }));
    if (
      result.status === 'Complete' ||
      result.status === 'Failed' ||
      result.status === 'Cancelled'
    ) {
      break;
    }
  }
  if (!result) throw new Error('Query never returned a status');
  if (result.status !== 'Complete') {
    throw new Error(
      `Query status=${result.status}; statistics=${JSON.stringify(result.statistics)}`,
    );
  }
  return (result.results || []).map((row) => {
    const out = {};
    for (const cell of row) out[cell.field] = cell.value;
    return out;
  });
}

// ---------- Optional DB join (gives venue / court context) ----------------
let pgClient = null;
async function maybeDbConnect() {
  const need = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
  if (need.some((k) => !process.env[k])) return false;
  const { Client } = require('pg');
  const sslOn = process.env.DB_SSL !== 'false';
  pgClient = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: sslOn ? { rejectUnauthorized: false } : undefined,
  });
  await pgClient.connect();
  return true;
}

async function resolveRecordings(recordingIds) {
  if (!pgClient || recordingIds.length === 0) return new Map();
  const { rows } = await pgClient.query(
    `SELECT r.id,
            r."cameraId",
            r."startTime",
            r.status,
            c.name           AS camera_name,
            c.court_number   AS court_number,
            t.name           AS venue
       FROM recordings r
  LEFT JOIN cameras c ON c.id = r."cameraId"
  LEFT JOIN turfs   t ON t.id = c."turfId"
      WHERE r.id = ANY($1::uuid[])`,
    [recordingIds],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------- Pretty printers -----------------------------------------------
const ANSI = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const rightPad = (s, n) =>
  String(s ?? '').length >= n
    ? String(s ?? '').slice(0, n)
    : String(s ?? '') + ' '.repeat(n - String(s ?? '').length);

// Extract a recording UUID from a log line if it contains one.
const UUID_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
// Extract the trailing error.message from the retry line, if present.
const ERR_TAIL_RE = /Retrying in \d+ms:\s*(.+)$/;

(async () => {
  console.error(
    `[pi-errors-recent] querying ${logGroup} for past ${days} day(s) in ${region}…`,
  );
  const rows = await runQuery();
  console.error(`[pi-errors-recent] got ${rows.length} matching log line(s).`);

  // Group log lines by recording id. A single failure produces 3 retry lines
  // plus a wrapper "Error in background..." line; we collapse them into one
  // record per recording id, keeping the latest timestamp and the error
  // message.
  const byRecording = new Map();
  const orphans = []; // lines with no parseable recording id
  for (const r of rows) {
    const msg = String(r['@message'] ?? '');
    const ts = r['@timestamp'];
    const recId = (msg.match(UUID_RE) || [])[1] ?? null;
    const errTail = (msg.match(ERR_TAIL_RE) || [])[1] ?? null;

    const entry =
      recId == null
        ? null
        : (byRecording.get(recId) ?? {
            recordingId: recId,
            firstSeen: ts,
            lastSeen: ts,
            attempts: 0,
            errorMessage: null,
            sampleLines: [],
            stream: r['@logStream'],
          });
    if (entry == null) {
      orphans.push({ ts, msg, stream: r['@logStream'] });
      continue;
    }
    entry.lastSeen = ts;
    if (entry.firstSeen > ts) entry.firstSeen = ts;
    if (msg.includes('Attempt') && msg.includes('Raspberry Pi failed')) {
      entry.attempts++;
      if (errTail && !entry.errorMessage) entry.errorMessage = errTail.trim();
    }
    entry.sampleLines.push(msg.length > 240 ? msg.slice(0, 240) + '…' : msg);
    byRecording.set(recId, entry);
  }

  // Optional DB join for venue / court / camera labels.
  const haveDb = await maybeDbConnect();
  const recs = haveDb
    ? await resolveRecordings(Array.from(byRecording.keys()))
    : new Map();

  // Decorate entries with DB context.
  const enriched = Array.from(byRecording.values()).map((e) => {
    const rec = recs.get(e.recordingId);
    return {
      ...e,
      venue: rec?.venue ?? null,
      court: rec?.court_number ?? null,
      camera: rec?.camera_name ?? null,
      status: rec?.status ?? null,
      startTime: rec?.startTime ?? null,
    };
  });

  // Apply venue filter (post-join — needs the venue label).
  const filtered = venueFilter
    ? enriched.filter((e) =>
        String(e.venue ?? '')
          .toLowerCase()
          .includes(venueFilter),
      )
    : enriched;

  // Sort newest first by lastSeen.
  filtered.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

  if (asJson) {
    console.log(JSON.stringify({ filtered, orphans }, null, 2));
  } else {
    console.log();
    console.log(
      ANSI.bold(
        `Raspberry Pi failures - past ${days} day(s) - ${filtered.length} unique recording(s)`,
      ),
    );
    if (venueFilter) console.log(ANSI.dim(`  venue filter: "${venueFilter}"`));
    if (!haveDb)
      console.log(
        ANSI.dim('  (DB env vars missing - venue/court columns will be blank)'),
      );
    console.log(ANSI.dim('-'.repeat(140)));
    console.log(
      ANSI.bold(
        `  ${rightPad('Last seen (UTC)', 23)} ${rightPad('Venue', 26)} ${rightPad('Court', 6)} ${rightPad('Rec', 10)} ${rightPad('Atmp', 5)} Error`,
      ),
    );
    console.log(ANSI.dim('-'.repeat(140)));
    if (filtered.length === 0) console.log(ANSI.dim('  (no rows match)'));
    /**
     * Correlate orphan "Attempt N to stop recording …" lines to nearby
     * recording-id-bearing wrapper lines. The retry lines never carry the
     * UUID — only the wrapper does — but they fire seconds apart from the
     * same code path, so a small time window join recovers the link.
     *
     * For each recording bucket, scan orphans within ±15 seconds of its
     * lastSeen timestamp and lift the first ERR_TAIL_RE match we find as
     * the canonical error message.
     */
    for (const e of filtered) {
      if (e.errorMessage) continue;
      const center = e.lastSeen ? Date.parse(e.lastSeen) : null;
      if (!center || Number.isNaN(center)) continue;
      let best = null;
      for (const o of orphans) {
        const t = o.ts ? Date.parse(o.ts) : null;
        if (!t || Number.isNaN(t)) continue;
        if (Math.abs(t - center) > 15_000) continue;
        const tail = (o.msg.match(ERR_TAIL_RE) || [])[1];
        if (tail) {
          best = tail.trim();
          break;
        }
      }
      if (best) e.errorMessage = best;
    }

    for (const e of filtered) {
      const t = (e.lastSeen || '').slice(0, 19);
      const err =
        e.errorMessage ||
        (e.sampleLines[0] || '').replace(/\s+/g, ' ').slice(0, 100);
      console.log(
        `  ${ANSI.dim(rightPad(t, 23))} ${ANSI.yellow(rightPad(e.venue ?? '-', 26))} ${rightPad(e.court ?? '?', 6)} ${ANSI.cyan(rightPad(e.recordingId.slice(0, 8), 10))} ${rightPad(e.attempts, 5)} ${ANSI.red(err.slice(0, 200))}`,
      );
    }
    if (orphans.length > 0) {
      console.log();
      console.log(
        ANSI.bold(
          `Attempt-line details (no recording id, but contain the real error string) — ${orphans.length}`,
        ),
      );
      console.log(ANSI.dim('-'.repeat(140)));
      // Extract just the "real" error tail using ERR_TAIL_RE so we don't
      // bury the diagnosis under retry boilerplate. Show up to 200 chars
      // of message body — long enough for ECONNREFUSED + IP + port +
      // any axios stack noise to come through.
      for (const o of orphans.slice(0, 20)) {
        const tail = (o.msg.match(ERR_TAIL_RE) || [])[1] ?? null;
        const cleanMsg = (o.msg || '').replace(/\s+/g, ' ');
        const display = tail ? tail.trim() : cleanMsg;
        console.log(
          `  ${ANSI.dim((o.ts || '').slice(0, 19))} ${ANSI.red(display.slice(0, 200))}`,
        );
      }
    }
  }

  if (pgClient) await pgClient.end();
})().catch((err) => {
  console.error('[pi-errors-recent] failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
