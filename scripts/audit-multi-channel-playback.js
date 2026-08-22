/**
 * Audit dual-channel sessions: how many are fully playable vs partial.
 * Usage: DB_HOST=... DB_USER=... DB_PASSWORD=... DB_DATABASE=... node scripts/audit-multi-channel-playback.js
 */
require('dotenv').config();
const { Client } = require('pg');

function isPlayable(status, muxId) {
  const s = String(status ?? '').toLowerCase();
  return (s === 'ready' || s === 'completed') && String(muxId ?? '').trim();
}

async function run() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'fieldflicks-dev',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const { rows: partial } = await client.query(`
    WITH sessions AS (
      SELECT
        r."cameraId",
        r."startTime",
        r."endTime",
        COUNT(*)::int AS channel_count,
        COUNT(*) FILTER (
          WHERE LOWER(r.status) IN ('ready','completed')
            AND r.mux_playback_id IS NOT NULL
            AND r.mux_playback_id <> ''
        )::int AS playable_count,
        array_agg(r.id ORDER BY COALESCE((r.metadata->>'nvr_channel')::int, 1)) AS ids,
        array_agg(r.status ORDER BY COALESCE((r.metadata->>'nvr_channel')::int, 1)) AS statuses,
        array_agg(COALESCE(r.mux_playback_id, '') ORDER BY COALESCE((r.metadata->>'nvr_channel')::int, 1)) AS mux_ids
      FROM recordings r
      WHERE r."startTime" IS NOT NULL AND r."endTime" IS NOT NULL
      GROUP BY r."cameraId", r."startTime", r."endTime"
      HAVING COUNT(*) > 1
    )
    SELECT *
    FROM sessions
    WHERE playable_count > 0 AND playable_count < channel_count
    ORDER BY "startTime" DESC
    LIMIT 50
  `);

  const { rows: summary } = await client.query(`
    WITH sessions AS (
      SELECT
        COUNT(*)::int AS channel_count,
        COUNT(*) FILTER (
          WHERE LOWER(r.status) IN ('ready','completed')
            AND r.mux_playback_id IS NOT NULL
            AND r.mux_playback_id <> ''
        )::int AS playable_count
      FROM recordings r
      WHERE r."startTime" IS NOT NULL AND r."endTime" IS NOT NULL
      GROUP BY r."cameraId", r."startTime", r."endTime"
      HAVING COUNT(*) > 1
    )
    SELECT
      COUNT(*)::int AS total_multi_channel_sessions,
      COUNT(*) FILTER (WHERE playable_count = channel_count)::int AS fully_playable,
      COUNT(*) FILTER (WHERE playable_count > 0 AND playable_count < channel_count)::int AS partial_playable,
      COUNT(*) FILTER (WHERE playable_count = 0)::int AS none_playable
    FROM sessions
  `);

  console.log('\n=== Multi-channel session summary ===');
  console.log(summary[0]);
  console.log(`\n=== Partial sessions (showing up to 50) ===`);
  for (const row of partial) {
    console.log(
      `- ${row.startTime?.toISOString?.() ?? row.startTime} camera=${row.cameraId} ${row.playable_count}/${row.channel_count} playable`,
    );
    console.log(`  ids: ${row.ids.join(', ')}`);
    console.log(`  status: ${row.statuses.join(' | ')}`);
    console.log(
      `  mux: ${row.mux_ids.map((m) => (m ? 'yes' : 'no')).join(' | ')}`,
    );
  }

  await client.end();
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
