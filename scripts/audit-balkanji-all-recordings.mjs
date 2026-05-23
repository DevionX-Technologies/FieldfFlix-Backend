/**
 * List every recording at "All India Balkanji Bari" — across BOTH the Pickleball
 * turf row (`…b263`) and the Cricket turf row (`…b264`), and any older row
 * whose name still matches.
 *
 * Why this exists:
 *   At some point the venue's turf carried `sports_supported = {Cricket}`.
 *   Then `Pickleball` was added (so n=2), which made the payment resolver fall
 *   through to the default `pickleball` tier (₹236). Old cricket recordings
 *   that ended up on the Pickleball turf row after the per-sport split are now
 *   billed as Pickleball.
 *
 * Output:
 *   For every Balkanji recording, dump turfId / turfName / sports_supported,
 *   cameraId / cameraName, startTime, current `metadata.fieldflix_session_sport`,
 *   payment count + statuses + amounts, plus a heuristic flag
 *   `is_likely_misattributed_cricket` set to TRUE when:
 *     - turf is Pickleball-only (would resolve paid)
 *     - AND the recording isn't already metadata-stamped as cricket
 *
 * Read-only. Re-run as often as you want.
 *
 * Usage:
 *   node scripts/audit-balkanji-all-recordings.mjs
 *   node scripts/audit-balkanji-all-recordings.mjs --pattern '%Some Other Venue%'
 *   node scripts/audit-balkanji-all-recordings.mjs --before 2026-04-30
 *
 * Filter args:
 *   --pattern <ILIKE>   override the default `%All India Balkanji Bari%`.
 *   --before YYYY-MM-DD only include recordings with startTime < that date
 *                       (handy if you know cricket-only era ended on a known date).
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const patternIdx = args.indexOf('--pattern');
const beforeIdx = args.indexOf('--before');
const pattern =
  patternIdx >= 0 && args[patternIdx + 1]
    ? args[patternIdx + 1]
    : '%All India Balkanji Bari%';
const beforeDate =
  beforeIdx >= 0 && args[beforeIdx + 1] ? args[beforeIdx + 1] : null;

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

const turfsRes = await client.query(
  `SELECT id, name, sports_supported FROM turfs WHERE name ILIKE $1 ORDER BY name`,
  [pattern],
);

const turfsById = new Map(turfsRes.rows.map((t) => [t.id, t]));
const turfIds = turfsRes.rows.map((t) => t.id);

const params = [turfIds];
let recSql = `
  SELECT r.id            AS recording_id,
         r."turfId"      AS turf_id,
         r."cameraId"    AS camera_id,
         c.name          AS camera_name,
         r."startTime"   AS start_time,
         r.metadata,
         (SELECT json_agg(p.* ORDER BY p.created_at)
            FROM payments p WHERE p.recording_id = r.id) AS payments
    FROM recordings r
    LEFT JOIN cameras c ON c.id = r."cameraId"
   WHERE r."turfId" = ANY($1::uuid[])
`;
if (beforeDate) {
  recSql += ` AND r."startTime" < $2::timestamptz`;
  params.push(beforeDate);
}
recSql += ` ORDER BY r."startTime" DESC`;

const recRes = await client.query(recSql, params);

const rows = recRes.rows.map((r) => {
  const turf = turfsById.get(r.turf_id);
  const sportsArr = coerceSportsSupported(turf?.sports_supported);
  const turfHasCricket = sportsArr.includes('Cricket');
  const turfHasPickle =
    sportsArr.includes('Pickleball') || sportsArr.includes('Pickle');
  const turfIsCricketOnly = sportsArr.length === 1 && turfHasCricket;
  const turfIsPickleOnly = sportsArr.length === 1 && turfHasPickle;
  const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
  const sessionSport = meta.fieldflix_session_sport ?? null;
  const payments = Array.isArray(r.payments) ? r.payments : [];
  return {
    recording_id: r.recording_id,
    turf_id: r.turf_id,
    turf_name: turf?.name,
    sports_supported: sportsArr,
    turf_is_cricket_only: turfIsCricketOnly,
    turf_is_pickle_only: turfIsPickleOnly,
    camera_id: r.camera_id,
    camera_name: r.camera_name,
    start_time: r.start_time,
    session_sport_meta: sessionSport,
    payment_count: payments.length,
    payment_statuses: payments.map((p) => p.status),
    payment_amounts: payments.map((p) => Number(p.amount)),
    /** Likely-cricket heuristic: turf is Pickleball-only AND no metadata flag. */
    is_likely_misattributed_cricket:
      turfIsPickleOnly && sessionSport !== 'cricket',
  };
});

const summary = {
  pattern,
  beforeDate,
  turfsMatched: turfsRes.rows.map((t) => ({
    id: t.id,
    name: t.name,
    sports_supported: coerceSportsSupported(t.sports_supported),
  })),
  totalRecordings: rows.length,
  byTurf: rows.reduce((acc, r) => {
    acc[r.turf_id] = (acc[r.turf_id] ?? 0) + 1;
    return acc;
  }, {}),
  countAlreadyOnCricketTurf: rows.filter((r) => r.turf_is_cricket_only).length,
  countOnPickleballTurf: rows.filter((r) => r.turf_is_pickle_only).length,
  countAlreadyMetadataCricket: rows.filter(
    (r) => r.session_sport_meta === 'cricket',
  ).length,
  countLikelyMisattributedCricket: rows.filter(
    (r) => r.is_likely_misattributed_cricket,
  ).length,
  countWithNonZeroPayments: rows.filter((r) =>
    r.payment_amounts.some((a) => a > 0),
  ).length,
  rows,
};

console.log(JSON.stringify(summary, null, 2));

await client.end();
