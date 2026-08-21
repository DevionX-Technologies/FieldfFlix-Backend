/**
 * Sync tournament liveStreams JSON from Neon (source of truth) to AWS RDS.
 * Run from a machine that can reach both DBs (or ECS task with Neon egress).
 *
 *   NEON_DATABASE_URL=... RDS_DATABASE_URL=... node scripts/sync-livestreams-neon-to-rds.js
 */
const { Client } = require('pg');

async function main() {
  const neonUrl =
    process.env.NEON_DATABASE_URL ||
    'postgresql://neondb_owner:npg_OwyVHutfN28n@ep-green-paper-aysc1pqc.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';

  const rdsUrl = process.env.RDS_DATABASE_URL || process.env.DATABASE_URL;

  if (!rdsUrl) {
    console.error('Set RDS_DATABASE_URL or DATABASE_URL');
    process.exit(1);
  }

  const neon = new Client({
    connectionString: neonUrl,
    ssl: { rejectUnauthorized: false },
  });
  const rds = new Client({
    connectionString: rdsUrl.includes('sslmode=')
      ? rdsUrl
      : `${rdsUrl}${rdsUrl.includes('?') ? '&' : '?'}sslmode=require`,
    ssl: { rejectUnauthorized: false },
  });

  await neon.connect();
  await rds.connect();

  const { rows } = await neon.query(
    `SELECT id, name, "liveStreams", "cameraIds", status FROM tournaments`,
  );

  console.log(`Found ${rows.length} tournaments on Neon`);

  for (const row of rows) {
    const liveCount = (row.liveStreams || []).filter(
      (s) => s.isLive && s.playbackUrl,
    ).length;

    await rds.query(
      `UPDATE tournaments SET "liveStreams" = $1::jsonb, "cameraIds" = $2::jsonb, status = $3 WHERE id = $4`,
      [
        JSON.stringify(row.liveStreams || []),
        JSON.stringify(row.cameraIds || []),
        row.status,
        row.id,
      ],
    );

    console.log(`Synced ${row.name} (${row.id}) — ${liveCount} live stream(s)`);
  }

  await neon.end();
  await rds.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
