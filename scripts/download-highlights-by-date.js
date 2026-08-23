#!/usr/bin/env node
/**
 * Download gateway highlight MP4s from S3, grouped by court, for a given IST date.
 *
 * Key format: highlights/court{N}_cam{M}_{YYYYMMDD-HHMMSS}_highlight.mp4
 * Timestamps in filenames are IST (Pi gateway local wall clock).
 *
 * Usage:
 *   node scripts/download-highlights-by-date.js --date=2025-08-22
 *   node scripts/download-highlights-by-date.js --date=2025-08-22 --out=../highlights-2025-08-22
 *
 * Requires .env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME, AWS_S3_REGION
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';
const REGION =
  process.env.AWS_S3_REGION || process.env.AWS_REGION || 'eu-north-1';

const HIGHLIGHT_KEY_RE =
  /^highlights\/court(\d+)_cam(\d+)_(\d{8})-(\d{6})_highlight\.mp4$/;

function arg(name) {
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

/** Parse Pi filename timestamp as UTC (matches s3-highlight-key.util.ts). */
function parseHighlightKeyTimestamp(datePart, timePart) {
  const year = datePart.slice(0, 4);
  const month = datePart.slice(4, 6);
  const day = datePart.slice(6, 8);
  const hour = timePart.slice(0, 2);
  const minute = timePart.slice(2, 4);
  const second = timePart.slice(4, 6);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function parseHighlightS3Key(key) {
  const match = HIGHLIGHT_KEY_RE.exec(key);
  if (!match) return null;
  const [, courtStr, camStr, datePart, timePart] = match;
  const windowStart = parseHighlightKeyTimestamp(datePart, timePart);
  return {
    key,
    court: parseInt(courtStr, 10),
    nvrCam: parseInt(camStr, 10),
    datePart,
    timePart,
    windowStart,
    istLabel: windowStart.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
    }),
  };
}

function dateToYmd(isoDate) {
  return isoDate.replace(/-/g, '');
}

async function listKeysForDate(s3, ymd) {
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
      if (!obj.Key) continue;
      const parsed = parseHighlightS3Key(obj.Key);
      if (parsed && parsed.datePart === ymd) keys.push(parsed);
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return keys.sort(
    (a, b) =>
      a.court - b.court || a.nvrCam - b.nvrCam || a.windowStart - b.windowStart,
  );
}

async function downloadObject(s3, key, destPath) {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const body = resp.Body;
  if (!body || typeof body.pipe !== 'function') {
    throw new Error(`Empty body for ${key}`);
  }
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    body.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    body.on('error', reject);
  });
}

async function main() {
  const dateArg = arg('--date') || '2025-08-22';
  const ymd = dateToYmd(dateArg);
  const outDir =
    arg('--out') ||
    path.resolve(__dirname, '..', '..', `highlights-${dateArg}-courtwise`);
  const concurrency = Math.max(
    1,
    Math.min(16, parseInt(arg('--concurrency') || '8', 10)),
  );

  const s3 = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  console.log(
    `Listing highlights for IST date ${dateArg} (${ymd}) from s3://${BUCKET}/`,
  );
  const items = await listKeysForDate(s3, ymd);
  console.log(`Found ${items.length} highlight file(s)`);

  if (items.length === 0) {
    console.log('Nothing to download.');
    return;
  }

  const manifest = {
    date: dateArg,
    timezone:
      'UTC (encoded in S3 key filenames; display filters by IST day overlap)',
    bucket: BUCKET,
    downloadedAt: new Date().toISOString(),
    courts: {},
    files: [],
  };

  let downloaded = 0;
  let skipped = 0;

  async function processItem(item) {
    const courtDir = path.join(outDir, `court${item.court}`);
    const fileName = `cam${item.nvrCam}_${item.timePart}_highlight.mp4`;
    const destPath = path.join(courtDir, fileName);

    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
      skipped += 1;
      return {
        s3Key: item.key,
        localPath: path.relative(outDir, destPath),
        court: item.court,
        nvrCam: item.nvrCam,
        istTimestamp: item.istLabel,
        utcIso: item.windowStart.toISOString(),
        sizeBytes: fs.statSync(destPath).size,
        skipped: true,
      };
    }

    await downloadObject(s3, item.key, destPath);
    downloaded += 1;
    return {
      s3Key: item.key,
      localPath: path.relative(outDir, destPath),
      court: item.court,
      nvrCam: item.nvrCam,
      istTimestamp: item.istLabel,
      utcIso: item.windowStart.toISOString(),
      sizeBytes: fs.statSync(destPath).size,
    };
  }

  const entries = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(processItem));
    for (const entry of results) {
      entries.push(entry);
      manifest.courts[`court${entry.court}`] =
        (manifest.courts[`court${entry.court}`] ?? 0) + 1;
      if (!entry.skipped) {
        process.stdout.write(
          `↓ ${Math.min(i + concurrency, items.length)}/${items.length} court${entry.court}/cam${entry.nvrCam} ${entry.localPath.split('_')[0].split('/')[1]?.replace('cam', '') || ''}\n`,
        );
      }
    }
  }

  manifest.files = entries;

  await fs.promises.mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'MANIFEST.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(
    `\nDownloaded ${downloaded} new file(s), skipped ${skipped} existing → ${outDir}`,
  );
  console.log(`Manifest: ${manifestPath}`);
  console.log('By court:', manifest.courts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
