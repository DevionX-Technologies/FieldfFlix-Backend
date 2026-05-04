/**
 * Restore cricket recordings to their FREE tier.
 *
 * Background:
 *   `payment.service.ts → unlockTierAndAmounts()` resolves a recording's tier
 *   in this order:
 *     1) `recording.metadata.fieldflix_session_sport` → `cricket | pickleball | padel`
 *     2) Fallback: `recording.turf.sports_supported` — only sets `cricket`
 *        when the turf has EXACTLY ONE sport and that sport is Cricket.
 *
 *   The recent `apply-turf-sports-supported.mjs` flipped some turfs to
 *   pickleball-only or pickleball+cricket. For mixed-sport turfs the fallback
 *   defaults to `pickleball` (paid), so cricket recordings recorded at those
 *   turfs were billed ₹236.
 *
 *   Quickest reversible fix: stamp the recordings themselves with
 *   `metadata.fieldflix_session_sport = 'cricket'`. That short-circuits the
 *   tier resolver to free without any structural change to turfs.
 *
 * What this script does:
 *   - Looks up turfs whose name matches CRICKET_TURF_PATTERNS (configurable)
 *     OR whose `sports_supported` includes Cricket.
 *   - Optionally narrows to specific cameras by COURT_NUMBERS_CRICKET (e.g.
 *     "Court 1 at Balkanji Bari" if cricket only happens on a single court).
 *   - For each matching recording it sets
 *     `metadata = jsonb_set(metadata, '{fieldflix_session_sport}', '"cricket"')`.
 *   - For each affected recording, it cancels any PENDING payments and marks
 *     COMPLETED non-zero payments as REFUNDED in the DB (Razorpay refund must
 *     still be issued from the dashboard or via API — this script does NOT
 *     hit Razorpay).
 *
 * Usage:
 *   node scripts/fix-cricket-recordings-sport.mjs                    # dry-run
 *   node scripts/fix-cricket-recordings-sport.mjs --apply            # commit
 *   node scripts/fix-cricket-recordings-sport.mjs --apply --include-completed
 *   node scripts/fix-cricket-recordings-sport.mjs --pattern '%All India Balkanji Bari%'
 *
 * Edit `CRICKET_TURF_PATTERNS` and `CRICKET_COURT_NUMBERS_BY_TURF` below to
 * match the venues that actually host cricket. Defaults reflect the
 * spreadsheet hint in `check-courts-vs-spreadsheet.mjs`.
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_COMPLETED = args.includes('--include-completed');
/** When set, ignore the camera/court filters and stamp EVERY recording on
 *  every matched turf as cricket. Use after `audit-balkanji-all-recordings.mjs`
 *  has confirmed that all those Pickleball-turf recordings should actually
 *  have been free cricket games. */
const ALL_RECORDINGS = args.includes('--all-recordings-on-turf');
/** When set, also stamp recordings whose turf is the **Pickleball-only** row
 *  for the matched venue (the migration target for old cricket recordings). */
const INCLUDE_PICKLEBALL_TURF = args.includes('--include-pickleball-turf');
const customPatternIdx = args.indexOf('--pattern');
const customPattern = customPatternIdx >= 0 ? args[customPatternIdx + 1] : null;
/** When set (YYYY-MM-DD), only touch recordings with `startTime` < that date.
 *  Lets us cap the fix to historical data so future recordings get whatever
 *  resolution comes from current turf+QR mappings, not this back-fill. */
const beforeIdx = args.indexOf('--before');
const beforeDate = beforeIdx >= 0 ? args[beforeIdx + 1] : null;
/** When set (YYYY-MM-DD), only touch recordings with `startTime` >= that date.
 *  Combine with `--before` to define a closed range. */
const afterIdx = args.indexOf('--after');
const afterDate = afterIdx >= 0 ? args[afterIdx + 1] : null;

/** ILIKE patterns for turf names that have at least one cricket court. */
const CRICKET_TURF_PATTERNS = customPattern
  ? [customPattern]
  : ['%All India Balkanji Bari%'];

/**
 * Cricket cameras — discovered via `node scripts/index-qr-codes.mjs`. Each ID
 * here is a camera that was a cricket court at the matching turf pattern but
 * may have had recordings attributed to the wrong (Pickleball) turf row.
 *
 * Per the current QR set:
 *   Balkanji court 4 (camera f31e) is the only cricket-mapped camera.
 *   Its QR points to turf `…b264` (Cricket only). Recordings on this camera
 *   that ended up on a Pickleball Balkanji turf row (`…b263`) are misattributed
 *   and should be flipped to cricket.
 */
const CRICKET_CAMERA_IDS_BY_PATTERN = {
  '%All India Balkanji Bari%': [
    '27ce1af1-721a-421c-9223-3ddeda95f31e', // Balkanji court 4 (cricket)
  ],
};

/**
 * Legacy court-number filter, kept as a fallback for older data shapes where
 * cameraId isn't reliable. The cameraId list above takes precedence when set.
 */
const CRICKET_COURT_NUMBERS_BY_PATTERN = {
  '%All India Balkanji Bari%': [4],
};

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

const startedAt = new Date().toISOString();
const summary = {
  mode: APPLY ? 'apply' : 'dry-run',
  startedAt,
  patterns: CRICKET_TURF_PATTERNS,
  afterDate,
  beforeDate,
  allRecordingsOnTurf: ALL_RECORDINGS,
  includePickleballTurf: INCLUDE_PICKLEBALL_TURF,
  includeCompleted: INCLUDE_COMPLETED,
  perPattern: [],
  totalRecordingsTouched: 0,
  totalPaymentsCancelled: 0,
  totalPaymentsRefunded: 0,
};

if (APPLY) await client.query('BEGIN');

try {
  for (const pattern of CRICKET_TURF_PATTERNS) {
    const turfsRes = await client.query(
      `SELECT id, name, sports_supported FROM turfs WHERE name ILIKE $1`,
      [pattern],
    );

    const block = {
      pattern,
      turfs: [],
      recordingsTouched: 0,
      paymentsCancelled: 0,
      paymentsRefunded: 0,
    };

    for (const turf of turfsRes.rows) {
      const cameraFilter = CRICKET_CAMERA_IDS_BY_PATTERN[pattern] ?? null;
      const courtFilter = CRICKET_COURT_NUMBERS_BY_PATTERN[pattern] ?? null;

      // If --include-pickleball-turf is set, only target turfs that are
      // currently Pickleball-only (the migration target for old cricket data).
      // Otherwise default behavior includes any turf matching the name pattern.
      if (INCLUDE_PICKLEBALL_TURF) {
        const sportsArr = Array.isArray(turf.sports_supported)
          ? turf.sports_supported.map(String)
          : String(turf.sports_supported ?? '')
              .replace(/^[{(]/, '')
              .replace(/[)}]$/, '')
              .split(',')
              .map((x) => x.replace(/"/g, '').trim())
              .filter(Boolean);
        const isPickleOnly =
          sportsArr.length === 1 &&
          (sportsArr[0] === 'Pickleball' || sportsArr[0] === 'Pickle');
        if (!isPickleOnly) continue;
      }

      // Recordings on this turf. Filter precedence:
      //   --all-recordings-on-turf  → no narrowing (every recording on the turf)
      //   else cameraFilter         → exact cameraId list
      //   else courtFilter          → legacy court-number-in-name regex
      const recParams = [turf.id];
      let recSql = `
        SELECT r.id, r.metadata, r."cameraId", c.name AS camera_name
        FROM recordings r
        LEFT JOIN cameras c ON c.id = r."cameraId"
        WHERE r."turfId" = $1
      `;
      if (ALL_RECORDINGS) {
        // No additional camera/court filter — all recordings on this turf.
      } else if (Array.isArray(cameraFilter) && cameraFilter.length > 0) {
        recSql += ` AND r."cameraId" = ANY($${recParams.length + 1}::uuid[])`;
        recParams.push(cameraFilter);
      } else if (Array.isArray(courtFilter) && courtFilter.length > 0) {
        const orParts = courtFilter
          .map(
            (_, i) =>
              `c.name ~ ('(^|[^0-9])' || $${recParams.length + 1 + i} || '([^0-9]|$)')`,
          )
          .join(' OR ');
        recSql += ` AND (${orParts})`;
        recParams.push(...courtFilter.map(String));
      }
      if (afterDate) {
        recSql += ` AND r."startTime" >= $${recParams.length + 1}::timestamptz`;
        recParams.push(afterDate);
      }
      if (beforeDate) {
        recSql += ` AND r."startTime" < $${recParams.length + 1}::timestamptz`;
        recParams.push(beforeDate);
      }

      const recordingsRes = await client.query(recSql, recParams);

      const turfBlock = {
        turfId: turf.id,
        turfName: turf.name,
        sports_supported: turf.sports_supported,
        cameraFilter,
        courtFilter: cameraFilter ? null : courtFilter,
        recordingsTotal: recordingsRes.rows.length,
        recordingsAlreadyCricket: 0,
        recordingsToFix: 0,
      };

      const recIdsToFix = [];
      for (const r of recordingsRes.rows) {
        const meta =
          r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
        if (meta.fieldflix_session_sport === 'cricket') {
          turfBlock.recordingsAlreadyCricket++;
          continue;
        }
        recIdsToFix.push(r.id);
      }
      turfBlock.recordingsToFix = recIdsToFix.length;
      block.turfs.push(turfBlock);

      if (APPLY && recIdsToFix.length > 0) {
        // 1) stamp metadata.fieldflix_session_sport = 'cricket'
        await client.query(
          `UPDATE recordings
              SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{fieldflix_session_sport}',
                '"cricket"'::jsonb,
                true
              )
            WHERE id = ANY($1::uuid[])`,
          [recIdsToFix],
        );
        block.recordingsTouched += recIdsToFix.length;

        // 2) cancel any pending payments on these recordings
        const pendingRes = await client.query(
          `UPDATE payments
              SET status = 'cancelled', updated_at = now()
            WHERE recording_id = ANY($1::uuid[])
              AND status = 'pending'
            RETURNING id`,
          [recIdsToFix],
        );
        block.paymentsCancelled += pendingRes.rowCount ?? 0;

        // 3) optionally mark completed paid rows as refunded (DB only — does
        //    NOT hit Razorpay; you'll need to refund manually if money moved).
        if (INCLUDE_COMPLETED) {
          const refundRes = await client.query(
            `UPDATE payments
                SET status = 'refunded', updated_at = now()
              WHERE recording_id = ANY($1::uuid[])
                AND status = 'completed'
                AND amount > 0
              RETURNING id`,
            [recIdsToFix],
          );
          block.paymentsRefunded += refundRes.rowCount ?? 0;
        }
      }
    }

    summary.perPattern.push(block);
    summary.totalRecordingsTouched += block.recordingsTouched;
    summary.totalPaymentsCancelled += block.paymentsCancelled;
    summary.totalPaymentsRefunded += block.paymentsRefunded;
  }

  if (APPLY) {
    await client.query('COMMIT');
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) {
    console.log(
      '\nDry-run complete. Re-run with --apply to commit. Add --include-completed to also DB-flag previously paid rows as refunded (Razorpay refund is manual).',
    );
  }
} catch (e) {
  if (APPLY) await client.query('ROLLBACK');
  console.error('Failed; rolled back.', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await client.end();
}
