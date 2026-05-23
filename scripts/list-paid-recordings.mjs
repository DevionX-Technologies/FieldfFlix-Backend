/**
 * List recordings at a venue that have at least one payment with amount > 0.
 * Sorted by recording start_time ASC so you can see the time spread at a glance.
 *
 * Usage:
 *   node scripts/list-paid-recordings.mjs                          # default %Santacruz West%
 *   node scripts/list-paid-recordings.mjs --pattern '%Eskay%'
 *   node scripts/list-paid-recordings.mjs --pattern '%Santacruz West%' --status completed
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const patternIdx = args.indexOf('--pattern');
const statusIdx = args.indexOf('--status');
const pattern =
  patternIdx >= 0 && args[patternIdx + 1]
    ? args[patternIdx + 1]
    : '%Santacruz West%';
const statusFilter =
  statusIdx >= 0 && args[statusIdx + 1] ? args[statusIdx + 1] : null;

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

const params = [pattern];
let sql = `
  SELECT r.id            AS recording_id,
         r."turfId"      AS turf_id,
         t.name          AS turf_name,
         t.sports_supported,
         r."cameraId"    AS camera_id,
         c.name          AS camera_name,
         r."startTime"   AS start_time,
         r.metadata->>'fieldflix_session_sport' AS session_sport_meta,
         json_agg(json_build_object(
           'id', p.id,
           'status', p.status,
           'amount', p.amount,
           'razorpay_order_id', p.razorpay_order_id,
           'razorpay_payment_id', p.razorpay_payment_id,
           'created_at', p.created_at,
           'paid_at', p.paid_at
         ) ORDER BY p.created_at) AS payments
    FROM recordings r
    INNER JOIN payments p ON p.recording_id = r.id AND p.amount > 0
    LEFT JOIN cameras c ON c.id = r."cameraId"
    LEFT JOIN turfs t ON t.id = r."turfId"
   WHERE t.name ILIKE $1
`;
if (statusFilter) {
  sql += ` AND p.status = $2`;
  params.push(statusFilter);
}
sql += `
   GROUP BY r.id, t.name, t.sports_supported, c.name
   ORDER BY r."startTime" ASC
`;

const res = await client.query(sql, params);

const summary = {
  pattern,
  statusFilter,
  totalPaidRecordings: res.rows.length,
  rows: res.rows.map((r) => ({
    recording_id: r.recording_id,
    start_time: r.start_time,
    turf_name: r.turf_name,
    camera_name: r.camera_name,
    session_sport_meta: r.session_sport_meta,
    payment_count: r.payments.length,
    payment_total_inr: r.payments.reduce((s, p) => s + Number(p.amount), 0),
    payments: r.payments,
  })),
};

console.log(JSON.stringify(summary, null, 2));

await client.end();
