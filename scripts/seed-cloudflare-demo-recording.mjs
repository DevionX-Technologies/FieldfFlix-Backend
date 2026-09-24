/**
 * Seeds a 10-minute Cloudflare Stream recording for demo user (8888888888 / +918888888888)
 * and marks it fully unlocked via a completed payment record.
 *
 * Usage:
 *   node scripts/seed-cloudflare-demo-recording.mjs --stream-uid <CLOUDFLARE_STREAM_UID>
 *   node scripts/seed-cloudflare-demo-recording.mjs --stream-uid <CLOUDFLARE_STREAM_UID> --phone 8888888888
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const streamUidIdx = args.indexOf('--stream-uid');
const phoneIdx = args.indexOf('--phone');
const nameIdx = args.indexOf('--name');

const streamUid =
  streamUidIdx >= 0 && args[streamUidIdx + 1] ? args[streamUidIdx + 1] : process.env.CLOUDFLARE_STREAM_DEMO_UID || null;

const rawPhone =
  phoneIdx >= 0 && args[phoneIdx + 1] ? args[phoneIdx + 1] : '8888888888';

const recordingName =
  nameIdx >= 0 && args[nameIdx + 1] ? args[nameIdx + 1] : 'Demo Match (Cloudflare 10m)';

const phone = rawPhone.startsWith('+')
  ? rawPhone
  : rawPhone.length === 10
  ? `+91${rawPhone}`
  : `+${rawPhone.replace(/\D/g, '')}`;

const { Client } = pg;
const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'neondb_owner',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'neondb',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log(`Connected to database: ${process.env.DB_DATABASE || 'neondb'}`);

  // 1. Find or create demo user
  let userRes = await client.query('SELECT * FROM users WHERE phone_number = $1 LIMIT 1', [phone]);
  let userId;
  if (userRes.rows.length === 0) {
    userId = uuidv4();
    await client.query(
      `INSERT INTO users (id, name, phone_number, "singUp_Method", created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [userId, 'Demo User', phone, 'PHONE_NUMBER']
    );
    console.log(`Created user ${userId} for phone ${phone}`);
  } else {
    userId = userRes.rows[0].id;
    console.log(`Found existing user ${userId} for phone ${phone}`);
  }

  // 2. Find an existing turf and camera
  let turfRes = await client.query('SELECT id, name FROM turfs LIMIT 1');
  let turfId = turfRes.rows[0]?.id || null;
  let turfName = turfRes.rows[0]?.name || 'Demo Turf';

  let cameraRes = await client.query('SELECT id, name FROM cameras LIMIT 1');
  let cameraId = cameraRes.rows[0]?.id || null;

  // 3. Create Recording
  const recordingId = uuidv4();
  const startTime = new Date(Date.now() - 15 * 60 * 1000); // 15 mins ago
  const endTime = new Date(Date.now() - 5 * 60 * 1000); // 5 mins ago (10 min duration)
  const durationSec = 600; // 10 minutes

  const metadata = {
    provider: 'cloudflare',
    cloudflareStreamUid: streamUid || 'cloudflare_stream_demo_uid',
    duration: durationSec,
    fieldflix_session_sport: 'Badminton',
    unlocked: true,
  };

  await client.query(
    `INSERT INTO recordings (
      id,
      "userId",
      "turfId",
      "cameraId",
      "startTime",
      "endTime",
      status,
      metadata,
      is_favorite,
      mux_playback_id,
      recording_name,
      "isVideoCreated",
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
    [
      recordingId,
      userId,
      turfId,
      cameraId,
      startTime,
      endTime,
      'ready',
      JSON.stringify(metadata),
      false,
      streamUid || 'cloudflare_stream_demo_uid',
      recordingName,
      true,
    ]
  );
  console.log(`Created Cloudflare recording ${recordingId} ("${recordingName}")`);

  // 4. Create Completed Payment to ensure Group Unlock
  const paymentId = uuidv4();
  await client.query(
    `INSERT INTO payments (
      id,
      user_id,
      recording_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      base_amount,
      currency,
      status,
      payment_type,
      description,
      metadata,
      paid_at,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())`,
    [
      paymentId,
      userId,
      recordingId,
      `order_demo_${Date.now()}`,
      `pay_demo_${Date.now()}`,
      'demo_signature_unlocked',
      240.0,
      240.0,
      'INR',
      'completed',
      'recording_access',
      'Demo Cloudflare Stream Unlocked Game',
      JSON.stringify({ note: 'Unlocked 10-minute Cloudflare demo match' }),
    ]
  );
  console.log(`Created completed payment ${paymentId} for recording ${recordingId}`);

  console.log('\n✅ Demo Game Added Successfully:');
  console.log({
    user_phone: phone,
    user_id: userId,
    recording_id: recordingId,
    recording_name: recordingName,
    turf_name: turfName,
    duration: '10 minutes',
    stream_uid: streamUid || '(Placeholder: please pass --stream-uid <UID>)',
    status: 'ready & unlocked',
  });

  await client.end();
}

main().catch((err) => {
  console.error('Error seeding demo recording:', err);
  process.exit(1);
});
