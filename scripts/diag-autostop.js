#!/usr/bin/env node
/**
 * diag-autostop.js — quick diagnostic for the v3.6 auto-stop cron.
 *
 * Prints three blocks:
 *   1. Status of the test recording (UUID from --id or hard-coded below)
 *   2. All currently in_progress rows with their overdue_sec
 *   3. All recordings that ENDED since v3.6 deployed (06:07:52 UTC on 2026-06-12)
 *
 * READ-ONLY. No writes anywhere.
 *
 * Usage:
 *   node -r dotenv/config scripts/diag-autostop.js
 *   node -r dotenv/config scripts/diag-autostop.js --id <recording-uuid>
 */
'use strict';

const { Client } = require('pg');

const argv = process.argv.slice(2);
const idIdx = argv.indexOf('--id');
const TEST_ID =
  idIdx >= 0 && argv[idIdx + 1]
    ? argv[idIdx + 1]
    : '97d1b08d-4838-4dfb-b764-0d832cc9e7aa'; // your test recording

// When v3.6 banner reported it booted. Anything ending after this is "post-cron".
const V36_DEPLOYED_AT = '2026-06-12T06:07:52Z';

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[diag-autostop] Missing env: ${missing.join(', ')}`);
  process.exit(2);
}

const c = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl:
    process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
});

(async () => {
  await c.connect();
  try {
    // 1) The test recording
    console.log('\n=== 1. YOUR TEST RECORDING ===');
    const a = await c.query(
      `SELECT id, status, "startTime", "endTime",
              EXTRACT(EPOCH FROM (COALESCE("endTime",NOW())-"startTime"))::int AS age_sec,
              (metadata->>'fieldflix_planned_duration_sec')::int AS planned_sec,
              EXTRACT(EPOCH FROM (NOW()-"startTime"))::int -
                (metadata->>'fieldflix_planned_duration_sec')::int AS overdue_sec
         FROM recordings WHERE id=$1`,
      [TEST_ID],
    );
    console.table(a.rows);

    // 2) Everything currently in_progress
    console.log(
      '\n=== 2. ALL CURRENTLY in_progress (cron should auto-stop overdue ones) ===',
    );
    const b = await c.query(
      `SELECT id, status, "startTime",
              (metadata->>'fieldflix_planned_duration_sec')::int AS planned,
              EXTRACT(EPOCH FROM (NOW()-"startTime"))::int AS age_sec,
              EXTRACT(EPOCH FROM (NOW()-"startTime"))::int -
                COALESCE((metadata->>'fieldflix_planned_duration_sec')::int, 999999) AS overdue_sec
         FROM recordings WHERE status='in_progress'
        ORDER BY "startTime" DESC LIMIT 10`,
    );
    console.table(b.rows);

    // 3) Things that ENDED since v3.6 deploy
    console.log(
      `\n=== 3. RECORDINGS that ENDED since v3.6 deployed (${V36_DEPLOYED_AT}) ===`,
    );
    const d = await c.query(
      `SELECT id, status, "endTime",
              EXTRACT(EPOCH FROM ("endTime"-"startTime"))::int AS actual_sec,
              (metadata->>'fieldflix_planned_duration_sec')::int AS planned_sec
         FROM recordings
        WHERE "endTime" >= $1::timestamptz
        ORDER BY "endTime" DESC LIMIT 10`,
      [V36_DEPLOYED_AT],
    );
    console.table(d.rows);

    // Quick verdict
    console.log('\n=== VERDICT ===');
    const yourRow = a.rows[0];
    if (!yourRow) {
      console.log('  Test recording not found in DB.');
    } else if (yourRow.status === 'completed' || yourRow.status === 'failed') {
      console.log(
        `  Cron FIRED for your test recording — status=${yourRow.status}, actual=${yourRow.age_sec}s vs planned=${yourRow.planned_sec}s`,
      );
    } else if (yourRow.overdue_sec > 60) {
      console.log(
        `  Cron has NOT fired for your test recording (overdue by ${yourRow.overdue_sec}s).`,
      );
      if (d.rows.length === 0) {
        console.log(
          '  Block 3 is empty — NO recordings have ended since deploy. Cron is almost certainly not running at all. Check ECS task logs.',
        );
      } else {
        console.log(
          `  But ${d.rows.length} other recordings have ended since deploy — cron may be running but skipping your row. Check planned_sec format above.`,
        );
      }
    } else {
      console.log('  Test recording not yet overdue. Wait more.');
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('[diag-autostop] error:', e.message);
  process.exit(1);
});
