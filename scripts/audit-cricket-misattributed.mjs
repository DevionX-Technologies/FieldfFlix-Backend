/**
 * Read-only audit: find recordings that were probably cricket games but ended
 * up attributed to a Pickleball turf row (so the payment resolver charged ₹236
 * instead of ₹0).
 *
 * Heuristic, based on the current QR set:
 *   - At Balkanji Bari, only `cameraId = 27ce1af1-721a-421c-9223-3ddeda95f31e`
 *     (Court 4) is the cricket camera. Its QR points at the Cricket-only turf
 *     row `…b264`, which yields the free unlock fallback.
 *   - Any recording on that camera that ended up on a *Pickleball* turf row
 *     (e.g. `…b263`) is the misattribution we're hunting.
 *
 * Usage:
 *   node scripts/audit-cricket-misattributed.mjs
 *
 * Output: JSON list of suspect recordings with their turf, camera, current
 * payment state, and whether `metadata.fieldflix_session_sport` is already
 * stamped as cricket. Nothing is modified — feed this list into
 * `fix-cricket-recordings-sport.mjs --apply` once it looks right.
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Cameras that *should* be cricket. From qr/index.json analysis. */
const CRICKET_CAMERA_IDS = ['27ce1af1-721a-421c-9223-3ddeda95f31e'];

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

// 1) Find every recording made on one of the cricket cameras.
const recRes = await client.query(
  `
  SELECT r.id            AS recording_id,
         r."cameraId"    AS camera_id,
         c.name          AS camera_name,
         r."turfId"      AS turf_id,
         t.name          AS turf_name,
         t.sports_supported,
         r."startTime"   AS start_time,
         r.metadata,
         (SELECT json_agg(p.* ORDER BY p.created_at)
            FROM payments p WHERE p.recording_id = r.id) AS payments
    FROM recordings r
    LEFT JOIN cameras c ON c.id = r."cameraId"
    LEFT JOIN turfs t ON t.id = r."turfId"
   WHERE r."cameraId" = ANY($1::uuid[])
   ORDER BY r."startTime" DESC
  `,
  [CRICKET_CAMERA_IDS],
);

/** Postgres returns enum-array columns either as JS arrays or as the textual
 *  array literal `"{Cricket,Pickleball}"`. Normalise both into a JS array. */
function coerceSportsSupported(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const s = String(raw).trim();
  if (s.startsWith('{') || s.startsWith('(')) {
    return s
      .replace(/^[{(]/, '')
      .replace(/[)}]$/, '')
      .split(',')
      .map((x) => x.replace(/"/g, '').trim())
      .filter(Boolean);
  }
  return [s];
}

const rows = recRes.rows.map((r) => {
  const meta =
    r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
  const sportsArr = coerceSportsSupported(r.sports_supported);
  const turfIsCricketOnly =
    sportsArr.length === 1 && sportsArr[0] === 'Cricket';
  const sessionSport = meta.fieldflix_session_sport ?? null;
  const payments = Array.isArray(r.payments) ? r.payments : [];
  return {
    recording_id: r.recording_id,
    camera_id: r.camera_id,
    camera_name: r.camera_name,
    turf_id: r.turf_id,
    turf_name: r.turf_name,
    sports_supported: sportsArr,
    turf_is_cricket_only: turfIsCricketOnly,
    session_sport_meta: sessionSport,
    start_time: r.start_time,
    payment_count: payments.length,
    payment_statuses: payments.map((p) => p.status),
    payment_amounts: payments.map((p) => Number(p.amount)),
    is_misattributed:
      // The flag we care about: this recording is on a cricket camera, but
      // its turf is NOT cricket-only and its metadata isn't already 'cricket'.
      !turfIsCricketOnly && sessionSport !== 'cricket',
  };
});

const summary = {
  cricketCameras: CRICKET_CAMERA_IDS,
  totalRecordingsOnCricketCameras: rows.length,
  alreadyOnCricketTurfOrFlagged: rows.filter((r) => !r.is_misattributed).length,
  misattributed: rows.filter((r) => r.is_misattributed).length,
  misattributedDetail: rows.filter((r) => r.is_misattributed),
  fineDetail: rows.filter((r) => !r.is_misattributed),
};

console.log(JSON.stringify(summary, null, 2));

await client.end();
