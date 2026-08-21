#!/usr/bin/env node
/**
 * Backfill recording_highlights from gateway S3 keys (highlights/court*_cam*_*.mp4).
 *
 *   node scripts/backfill-s3-highlights.mjs [--dry-run]
 */
const { Client } = require('pg');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';
const REGION =
  process.env.AWS_S3_REGION || process.env.AWS_REGION || 'eu-north-1';

const HIGHLIGHT_KEY_RE =
  /^highlights\/court(\d+)_cam(\d+)_(\d{8})-(\d{6})_highlight\.mp4$/;

function parseHighlightKeyTimestamp(datePart, timePart) {
  const year = parseInt(datePart.slice(0, 4), 10);
  const month = parseInt(datePart.slice(4, 6), 10) - 1;
  const day = parseInt(datePart.slice(6, 8), 10);
  const hour = parseInt(timePart.slice(0, 2), 10);
  const minute = parseInt(timePart.slice(2, 4), 10);
  const second = parseInt(timePart.slice(4, 6), 10);
  const istAsUtcMs = Date.UTC(year, month, day, hour, minute, second);
  return new Date(istAsUtcMs - 5.5 * 60 * 60 * 1000);
}

function parseHighlightS3Key(key) {
  const match = HIGHLIGHT_KEY_RE.exec(key);
  if (!match) return null;
  const [, courtStr, camStr, datePart, timePart] = match;
  return {
    key,
    court: parseInt(courtStr, 10),
    nvrCam: parseInt(camStr, 10),
    windowStart: parseHighlightKeyTimestamp(datePart, timePart),
  };
}

function buildHighlightPublicUrl(key) {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encoded}`;
}

function formatRelativeTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function listAllHighlightKeys(s3) {
  const keys = [];
  let token;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: 'highlights/',
        ContinuationToken: token,
      }),
    );
    for (const obj of resp.Contents || []) {
      if (obj.Key && parseHighlightS3Key(obj.Key)) keys.push(obj.Key);
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function resolveCameraId(db, court, nvrCam) {
  const { rows: cameras } = await db.query(
    `SELECT c.id, c.court_number, c."raspberryPiBaseUrl", t.name AS turf_name
     FROM cameras c
     LEFT JOIN turfs t ON t.id = c."turfId"
     WHERE c.court_number = $1`,
    [court],
  );
  if (cameras.length === 0) return null;

  const botanicalMap = {
    1: { ch1: 6, ch2: 7 },
    2: { ch1: 4, ch2: 12 },
    3: { ch1: 8, ch2: 9 },
    4: { ch1: 5, ch2: 11 },
    5: { ch1: 2, ch2: 3 },
    6: { ch1: 1, ch2: 10 },
  };

  const isBotanicalVenue = cameras.some(
    (cam) =>
      String(cam.turf_name || '')
        .toLowerCase()
        .includes('botanical') ||
      String(cam.raspberryPiBaseUrl || '').includes('cpu.taild82368.ts.net'),
  );

  if (isBotanicalVenue) {
    const map = botanicalMap[court];
    if (map) {
      let slot = null;
      if (nvrCam === map.ch1) slot = 1;
      else if (nvrCam === map.ch2) slot = 2;
      if (slot) {
        const slotCam = cameras.find((c) => c.id.endsWith(`_ch${slot}`));
        if (slotCam) return slotCam.id;
      }
    }
  } else {
    const byCourtChannel = cameras.find((c) => c.court_number === nvrCam);
    if (byCourtChannel) return byCourtChannel.id;
  }

  return cameras[0].id;
}

async function findRecordingForHighlight(db, cameraId, windowStart) {
  const { rows } = await db.query(
    `SELECT id, "startTime", "endTime"
     FROM recordings
     WHERE "cameraId" = $1
       AND "startTime" IS NOT NULL
       AND "startTime" <= $2
       AND ("endTime" IS NULL OR "endTime" >= $2)
     ORDER BY "startTime" DESC
     LIMIT 1`,
    [cameraId, windowStart],
  );
  if (rows[0]) return rows[0];

  const { rows: nearest } = await db.query(
    `SELECT id, "startTime", "endTime"
     FROM recordings
     WHERE "cameraId" = $1 AND "startTime" IS NOT NULL
     ORDER BY ABS(EXTRACT(EPOCH FROM ("startTime" - $2::timestamptz))) ASC
     LIMIT 1`,
    [cameraId, windowStart],
  );
  return nearest[0] ?? null;
}

async function main() {
  const db = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  const s3 = new S3Client({
    region: process.env.AWS_S3_REGION || process.env.AWS_REGION || 'eu-north-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  await db.connect();
  const keys = await listAllHighlightKeys(s3);
  console.log(
    `Found ${keys.length} highlight objects in s3://${BUCKET}/highlights/`,
  );

  let inserted = 0;
  let skipped = 0;

  for (const key of keys) {
    const parsed = parseHighlightS3Key(key);
    if (!parsed) continue;

    const existing = await db.query(
      `SELECT id FROM recording_highlights WHERE s3path = $1 LIMIT 1`,
      [key],
    );
    if (existing.rows.length > 0) {
      skipped += 1;
      continue;
    }

    const cameraId = await resolveCameraId(db, parsed.court, parsed.nvrCam);
    if (!cameraId) {
      console.warn(
        `skip ${key} — no camera for court ${parsed.court} cam ${parsed.nvrCam}`,
      );
      skipped += 1;
      continue;
    }

    const recording = await findRecordingForHighlight(
      db,
      cameraId,
      parsed.windowStart,
    );
    if (!recording?.startTime) {
      console.warn(`skip ${key} — no recording for camera ${cameraId}`);
      skipped += 1;
      continue;
    }

    const relativeSeconds = Math.floor(
      (parsed.windowStart.getTime() - new Date(recording.startTime).getTime()) /
        1000,
    );
    if (relativeSeconds < 5) {
      skipped += 1;
      continue;
    }

    const publicUrl = buildHighlightPublicUrl(key, BUCKET);
    const relativeTimestamp = formatRelativeTime(relativeSeconds);

    if (DRY_RUN) {
      console.log(`would insert ${key} → recording ${recording.id}`);
      inserted += 1;
      continue;
    }

    const maxOrder = await db.query(
      `SELECT COALESCE(MAX(processing_order), 0) AS n FROM recording_highlights WHERE recording_id = $1`,
      [recording.id],
    );
    const processingOrder = parseInt(maxOrder.rows[0].n, 10) + 1;

    await db.query(
      `INSERT INTO recording_highlights (
         recording_id, button_click_timestamp, relative_timestamp, status,
         s3path, mux_public_playback_url, "bucketName", "isClipCreated", processing_order,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'ready', $4, $5, $6, true, $7, NOW(), NOW())`,
      [
        recording.id,
        parsed.windowStart,
        relativeTimestamp,
        key,
        publicUrl,
        BUCKET,
        processingOrder,
      ],
    );
    inserted += 1;
  }

  console.log(
    `Done. inserted=${inserted} skipped=${skipped} dryRun=${DRY_RUN}`,
  );
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
