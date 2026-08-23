#!/usr/bin/env node
/**
 * Compare S3 gateway highlights vs DB-linked rows by court for an IST date.
 *
 *   node scripts/audit-highlight-match.js --date=2026-08-22
 *   node scripts/audit-highlight-match.js --date=2026-08-23 --court=4
 */
require('dotenv').config();
const { Client } = require('pg');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const RE = /^highlights\/court(\d+)_cam(\d+)_(\d{8})-(\d{6})_highlight\.mp4$/;

function arg(name) {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

function parseIstTimestamp(datePart, timePart) {
  const y = datePart.slice(0, 4);
  const mo = datePart.slice(4, 6);
  const d = datePart.slice(6, 8);
  const h = timePart.slice(0, 2);
  const mi = timePart.slice(2, 4);
  const s = timePart.slice(4, 6);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`);
}

async function listS3ByCourt(s3, ymd, courtFilter) {
  const byCourt = {};
  let token;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets',
        Prefix: 'highlights/',
        ContinuationToken: token,
      }),
    );
    for (const obj of resp.Contents || []) {
      const m = RE.exec(obj.Key || '');
      if (!m || m[3] !== ymd) continue;
      const court = parseInt(m[1], 10);
      if (courtFilter && court !== courtFilter) continue;
      if (!byCourt[court]) byCourt[court] = [];
      byCourt[court].push({
        key: obj.Key,
        nvrCam: parseInt(m[2], 10),
        at: parseIstTimestamp(m[3], m[4]),
      });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return byCourt;
}

async function main() {
  const dateArg = arg('--date') || '2026-08-22';
  const ymd = dateArg.replace(/-/g, '');
  const courtFilter = arg('--court') ? parseInt(arg('--court'), 10) : null;
  const { dayStart, dayEnd } = (() => {
    const dayStart = new Date(`${dateArg}T00:00:00+05:30`);
    const dayEnd = new Date(`${dateArg}T23:59:59.999+05:30`);
    return { dayStart, dayEnd };
  })();

  const s3 = new S3Client({
    region: process.env.AWS_S3_REGION || 'eu-north-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const db = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const s3ByCourt = await listS3ByCourt(s3, ymd, courtFilter);

  const { rows: dbLinked } = await db.query(
    `SELECT rh.s3path, rh.button_click_timestamp, c.court_number
     FROM recording_highlights rh
     JOIN recordings r ON r.id = rh.recording_id
     LEFT JOIN cameras c ON c.id = r."cameraId"
     WHERE rh.s3path LIKE $1
       AND rh.button_click_timestamp >= $2
       AND rh.button_click_timestamp <= $3`,
    [`%_${ymd}-%`, dayStart, dayEnd],
  );

  const dbByCourt = {};
  const linkedKeys = new Set();
  for (const row of dbLinked) {
    const m = RE.exec(row.s3path || '');
    const court = m ? parseInt(m[1], 10) : row.court_number || 0;
    if (courtFilter && court !== courtFilter) continue;
    dbByCourt[court] = (dbByCourt[court] || 0) + 1;
    if (row.s3path) linkedKeys.add(row.s3path);
  }

  const courts = new Set([
    ...Object.keys(s3ByCourt).map(Number),
    ...Object.keys(dbByCourt).map(Number),
  ]);

  console.log(`\nHighlight match audit — IST ${dateArg}\n`);
  console.log('Court | S3 files | DB linked | Unlinked in S3');
  console.log('------|----------|-----------|----------------');

  let totalS3 = 0;
  let totalDb = 0;
  let totalUnlinked = 0;

  for (const court of [...courts].sort((a, b) => a - b)) {
    const s3List = s3ByCourt[court] || [];
    const s3Count = s3List.length;
    const dbCount = dbByCourt[court] || 0;
    const unlinked = s3List.filter((x) => !linkedKeys.has(x.key)).length;
    totalS3 += s3Count;
    totalDb += dbCount;
    totalUnlinked += unlinked;
    console.log(
      `${String(court).padStart(5)} | ${String(s3Count).padStart(8)} | ${String(dbCount).padStart(9)} | ${String(unlinked).padStart(14)}`,
    );
  }

  console.log('------|----------|-----------|----------------');
  console.log(
    `${'TOTAL'.padStart(5)} | ${String(totalS3).padStart(8)} | ${String(totalDb).padStart(9)} | ${String(totalUnlinked).padStart(14)}`,
  );

  const { rows: sessions } = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM recordings r
     WHERE r."startTime" <= $2 AND (r."endTime" IS NULL OR r."endTime" >= $1)`,
    [dayStart, dayEnd],
  );
  console.log(
    `\nExtraction sessions overlapping IST day: ${sessions[0]?.cnt ?? 0}`,
  );
  console.log(
    totalUnlinked === 0
      ? '\n✓ All S3 highlights for this date are linked in DB.'
      : `\n⚠ ${totalUnlinked} S3 file(s) not linked — run: npm run reattach:all-s3-highlights -- --since=${dateArg}`,
  );

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
