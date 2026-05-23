/**
 * Walk every QR PNG in `qr/`, decode the embedded payload (which is the JSON
 * shape `qrCodeDataSchema` in the mobile app — `{ turfId, cameraId,
 * GroundNumber, GroundLocation, GroundDescription, Name, Size }`), and produce:
 *
 *   1) `qr/index.json`  — a manifest mapping filename → decoded payload + a
 *                         derived `arena_slug` and `court_number`. This is the
 *                         "index" you can ship alongside the PNGs.
 *
 *   2) A DB audit, printed to stdout:
 *      - QRs whose `turfId` doesn't exist in the `turfs` table
 *      - QRs whose `cameraId` doesn't exist in the `cameras` table (or whose
 *        cameraId is for a different turf)
 *      - DB cameras with no matching QR (orphan cameras)
 *      - QR PNGs that failed to decode (corrupt / not a QR)
 *
 * Usage:
 *   # one-time install (the script auto-installs at runtime if missing):
 *   npm i -D jsqr pngjs
 *
 *   node scripts/index-qr-codes.mjs                 # writes qr/index.json + audit
 *   node scripts/index-qr-codes.mjs --no-audit      # manifest only, skip DB
 *   node scripts/index-qr-codes.mjs --no-write      # audit only, don't touch fs
 *   node scripts/index-qr-codes.mjs --qr-dir <path> # custom QR directory
 */
import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ---------- runtime deps (auto-load) ---------------------------------------

let jsQR;
let PNG;
try {
  jsQR = require('jsqr').default ?? require('jsqr');
  PNG = require('pngjs').PNG;
} catch {
  console.error('Missing deps. Install once with:\n  npm i -D jsqr pngjs\n');
  process.exit(1);
}

// ---------- args ------------------------------------------------------------

const args = process.argv.slice(2);
const NO_AUDIT = args.includes('--no-audit');
const NO_WRITE = args.includes('--no-write');
const qrDirIdx = args.indexOf('--qr-dir');
const QR_DIR =
  qrDirIdx >= 0 && args[qrDirIdx + 1]
    ? path.resolve(args[qrDirIdx + 1])
    : path.join(__dirname, '..', 'qr');

const OUT_PATH = path.join(QR_DIR, 'index.json');

// ---------- helpers ---------------------------------------------------------

function decodePngToImageData(filePath) {
  const buf = fs.readFileSync(filePath);
  const png = PNG.sync.read(buf);
  return {
    data: new Uint8ClampedArray(
      png.data.buffer,
      png.data.byteOffset,
      png.data.byteLength,
    ),
    width: png.width,
    height: png.height,
  };
}

function decodeQrFromPng(filePath) {
  const img = decodePngToImageData(filePath);
  const code = jsQR(img.data, img.width, img.height);
  if (!code) return null;
  return code.data;
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function arenaSlugFromName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function courtNumberFromName(s) {
  if (s == null) return null;
  const m = String(s).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function courtNumberFromFilename(filename) {
  // patterns:
  //   court12.png            -> 12
  //   <Arena>__<Loc>_3.png   -> 3
  const base = filename.replace(/\.png$/i, '');
  const tail = base.match(/(\d+)$/);
  return tail ? Number(tail[1]) : null;
}

// ---------- pass 1: scan + decode QRs --------------------------------------

if (!fs.existsSync(QR_DIR)) {
  console.error(`QR directory not found: ${QR_DIR}`);
  process.exit(1);
}

const pngFiles = fs
  .readdirSync(QR_DIR)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .sort();

const manifest = [];
const undecodable = [];

for (const filename of pngFiles) {
  const full = path.join(QR_DIR, filename);
  let raw = null;
  try {
    raw = decodeQrFromPng(full);
  } catch (e) {
    undecodable.push({ filename, reason: `png-decode: ${e.message}` });
    continue;
  }
  if (raw == null) {
    undecodable.push({ filename, reason: 'no-qr-detected' });
    continue;
  }
  const payload = tryParseJson(raw);
  if (!payload || typeof payload !== 'object') {
    undecodable.push({ filename, reason: 'qr-not-json', raw });
    continue;
  }

  const courtFromName = courtNumberFromName(payload.GroundNumber);
  const courtFromFile = courtNumberFromFilename(filename);

  manifest.push({
    filename,
    arena_slug: arenaSlugFromName(payload.Name ?? payload.GroundDescription),
    court_number: courtFromName ?? courtFromFile ?? null,
    payload,
  });
}

if (!NO_WRITE) {
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        qr_dir: path.relative(path.join(__dirname, '..'), QR_DIR),
        total_pngs: pngFiles.length,
        decoded_count: manifest.length,
        undecodable_count: undecodable.length,
        items: manifest,
        undecodable,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${OUT_PATH}`);
}

// ---------- pass 2: DB audit -----------------------------------------------

if (NO_AUDIT) {
  console.log(
    JSON.stringify(
      {
        mode: 'manifest-only',
        decoded: manifest.length,
        undecodable: undecodable.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const { Client } = pg;
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'fieldflicks-dev',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const turfIds = [
  ...new Set(manifest.map((x) => x.payload.turfId).filter(Boolean)),
];
const cameraIds = [
  ...new Set(manifest.map((x) => x.payload.cameraId).filter(Boolean)),
];

const dbTurfsRes = await client.query(
  `SELECT id, name FROM turfs WHERE id = ANY($1::uuid[])`,
  [turfIds],
);
const dbTurfs = new Map(dbTurfsRes.rows.map((r) => [r.id, r]));

const dbCamerasRes = await client.query(
  `SELECT id, name, "turfId" FROM cameras WHERE id = ANY($1::uuid[])`,
  [cameraIds],
);
const dbCameras = new Map(dbCamerasRes.rows.map((r) => [r.id, r]));

const allCamerasRes = await client.query(
  `SELECT id, name, "turfId" FROM cameras
   WHERE "turfId" = ANY($1::uuid[])`,
  [turfIds],
);

const orphanCameras = allCamerasRes.rows.filter(
  (cam) => !cameraIds.includes(cam.id),
);

const missingTurfs = manifest
  .filter((m) => m.payload.turfId && !dbTurfs.has(m.payload.turfId))
  .map((m) => ({ filename: m.filename, turfId: m.payload.turfId }));

const missingCameras = manifest
  .filter((m) => m.payload.cameraId && !dbCameras.has(m.payload.cameraId))
  .map((m) => ({
    filename: m.filename,
    cameraId: m.payload.cameraId,
    turfId: m.payload.turfId,
  }));

const turfMismatch = manifest
  .filter(
    (m) =>
      m.payload.turfId &&
      m.payload.cameraId &&
      dbCameras.has(m.payload.cameraId) &&
      dbCameras.get(m.payload.cameraId).turfId !== m.payload.turfId,
  )
  .map((m) => ({
    filename: m.filename,
    cameraId: m.payload.cameraId,
    qrTurfId: m.payload.turfId,
    dbTurfId: dbCameras.get(m.payload.cameraId).turfId,
  }));

const audit = {
  total_qr_pngs: pngFiles.length,
  decoded: manifest.length,
  undecodable: undecodable.length,
  unique_turfs_in_qrs: turfIds.length,
  unique_cameras_in_qrs: cameraIds.length,
  matched_turfs_in_db: dbTurfs.size,
  matched_cameras_in_db: dbCameras.size,
  qrs_with_missing_turf: missingTurfs,
  qrs_with_missing_camera: missingCameras,
  qrs_with_turf_mismatch: turfMismatch,
  orphan_db_cameras_at_known_turfs: orphanCameras,
};

console.log(JSON.stringify(audit, null, 2));

await client.end();
