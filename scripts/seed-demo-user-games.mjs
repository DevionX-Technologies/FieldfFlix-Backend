import pg from 'pg';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const pool = new pg.Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'neondb_owner',
  password: process.env.DB_PASSWORD || 'npg_OwyVHutfN28n',
  database: process.env.DB_DATABASE || 'neondb',
});

async function seedDemoData() {
  const client = await pool.connect();
  try {
    console.log('--- Connecting to local DB ---');

    // 1. Ensure Demo User exists
    const demoPhone = '+918888888888';
    let userRes = await client.query('SELECT * FROM users WHERE phone_number = $1', [demoPhone]);
    let demoUser = userRes.rows[0];

    if (!demoUser) {
      console.log('Creating demo user...');
      const insertUserRes = await client.query(
        `INSERT INTO users (id, name, phone_number, "singUp_Method", email)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [randomUUID(), 'Demo User', demoPhone, 'PHONE_NUMBER', 'demouser@fieldflicks.com']
      );
      demoUser = insertUserRes.rows[0];
    }
    console.log(`Demo User: ${demoUser.name} (${demoUser.id})`);

    // 2. Fetch turfs and cameras
    const turfsRes = await client.query('SELECT * FROM turfs');
    const camerasRes = await client.query('SELECT * FROM cameras');

    if (turfsRes.rows.length === 0 || camerasRes.rows.length === 0) {
      throw new Error('No turfs or cameras found. Run seed-fleet-venues.mjs first.');
    }

    const eskayTurf = turfsRes.rows.find(t => t.name.includes('Eskay')) || turfsRes.rows[0];
    const balkanjiTurf = turfsRes.rows.find(t => t.name.includes('Balkanji')) || turfsRes.rows[1] || turfsRes.rows[0];
    const padelTurf = turfsRes.rows.find(t => t.name.includes('Padel')) || turfsRes.rows[2] || turfsRes.rows[0];
    const pickpadTurf = turfsRes.rows.find(t => t.name.includes('PickPad')) || turfsRes.rows[3] || turfsRes.rows[0];

    const eskayCam = camerasRes.rows.find(c => c.turfId === eskayTurf.id) || camerasRes.rows[0];
    const balkanjiCam = camerasRes.rows.find(c => c.turfId === balkanjiTurf.id) || camerasRes.rows[1] || camerasRes.rows[0];
    const padelCam = camerasRes.rows.find(c => c.turfId === padelTurf.id) || camerasRes.rows[2] || camerasRes.rows[0];
    const pickpadCam = camerasRes.rows.find(c => c.turfId === pickpadTurf.id) || camerasRes.rows[3] || camerasRes.rows[0];

    // Real verified playable Mux streams from account
    const muxVideos = [
      {
        playbackId: 'dT3DAy24AgWKackxwIjNbGRwuJ2YO021p8201ITJ01CrK8',
        assetId: 'QLAnybJxNEcgyzSrgTRqqpImmSEGPY01rmJ2B11UlVF4',
      },
      {
        playbackId: 'r978IJZmvyjm5sj2E01hRYDPSWiVnsxyjUQckJJf1eRY',
        assetId: 'Njv6yTqCwc2yPbadiZbDdVrRinwf1LiJmckgcGmAAVw',
      },
      {
        playbackId: '2vndyxaGCnHnTOfOGXunbJhYeJ3mN01EZRVrnmow1Hls',
        assetId: 'NPCQ9GRzJ6kt4jbsLjDaFxkv00sHuND8ldBuc1VB4Ie4',
      },
      {
        playbackId: 'fB01oMuau6lc00xm8700JsD6iXtrphm6I1pRZ8MbxmRCoI',
        assetId: 'aRVzFjhesuFD3IEs60201HPjzOvmV8hwqRd016eYl00t2G00',
      },
    ];

    // Clear old demo recordings to avoid duplication
    await client.query('DELETE FROM recordings WHERE "userId" = $1', [demoUser.id]);
    console.log('Cleared previous demo recordings.');

    const now = new Date();

    const gamesData = [
      {
        name: 'Pickleball Masters - Championship Finals',
        turf: eskayTurf,
        camera: eskayCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        video: muxVideos[0],
        status: 'ready',
        highlights: [
          { title: 'Ace Serve Winner', offset: 320, label: 'Ace' },
          { title: 'Dramatic Kitchen Rally', offset: 950, label: 'Rally' },
          { title: 'Championship Winning Smash', offset: 2100, label: 'Match Point' },
        ],
      },
      {
        name: 'Padel Night Clash - Semi Finals',
        turf: padelTurf,
        camera: padelCam,
        sport: 'Padel',
        startTime: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        video: muxVideos[1],
        status: 'ready',
        highlights: [
          { title: 'Backhand Wall Rebound', offset: 410, label: 'Wall Play' },
          { title: 'Drop Volley at the Net', offset: 1280, label: 'Volley' },
        ],
      },
      {
        name: 'Sunset Pickleball Doubles',
        turf: balkanjiTurf,
        camera: balkanjiCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        video: muxVideos[2],
        status: 'ready',
        highlights: [
          { title: 'Fast Reflex Volley Exchange', offset: 180, label: 'Volley' },
          { title: 'Crosscourt Dinking Masterclass', offset: 840, label: 'Dink' },
        ],
      },
      {
        name: 'PickPad Intense Practice Session',
        turf: pickpadTurf,
        camera: pickpadCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        video: muxVideos[3],
        status: 'ready',
        highlights: [
          { title: 'Third Shot Drop Execution', offset: 250, label: 'Drop Shot' },
          { title: 'Down-the-Line Passing Shot', offset: 1120, label: 'Winner' },
        ],
      },
    ];

    for (const g of gamesData) {
      const recordingId = randomUUID();
      const metadata = {
        fieldflix_session_sport: g.sport,
        court_number: g.camera.court_number,
        camera_label: g.camera.name,
        plannedDurationSec: 3600,
        unlocked: true,
      };

      // 1. Insert Recording
      await client.query(
        `INSERT INTO recordings (
          id, "userId", "turfId", "cameraId", "startTime", "endTime",
          status, recording_name, mux_asset_id, mux_playback_id, mux_media_url,
          metadata, "is_favorite", "isVideoCreated"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14
        )`,
        [
          recordingId,
          demoUser.id,
          g.turf.id,
          g.camera.id,
          g.startTime,
          g.endTime,
          g.status,
          g.name,
          g.video.assetId,
          g.video.playbackId,
          `https://stream.mux.com/${g.video.playbackId}.m3u8`,
          JSON.stringify(metadata),
          true,
          true,
        ]
      );

      // 2. Insert Highlights for this recording
      for (const h of g.highlights) {
        const highlightId = randomUUID();
        const clickTime = new Date(g.startTime.getTime() + h.offset * 1000);
        const relTime = new Date(h.offset * 1000).toISOString().substring(11, 19);

        await client.query(
          `INSERT INTO recording_highlights (
            id, recording_id, button_click_timestamp, relative_timestamp,
            status, playback_id, mux_public_playback_url, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            highlightId,
            recordingId,
            clickTime,
            relTime,
            'ready',
            g.video.playbackId,
            `https://stream.mux.com/${g.video.playbackId}.m3u8`,
            JSON.stringify({
              title: h.title,
              label: h.label,
              highlight_title: h.title,
              duration: 30,
              thumbnailUrl: `https://image.mux.com/${g.video.playbackId}/thumbnail.jpg`,
            }),
          ]
        );
      }

      // 3. Insert Completed Payment (Fully Unlocked for Demo User)
      const paymentId = randomUUID();
      await client.query(
        `INSERT INTO payments (
          id, user_id, recording_id, razorpay_order_id, razorpay_payment_id,
          amount, base_amount, currency, status, payment_type,
          description, metadata, paid_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          paymentId,
          demoUser.id,
          recordingId,
          `order_demo_${recordingId.slice(0, 8)}`,
          `pay_demo_${recordingId.slice(0, 8)}`,
          240.00,
          240.00,
          'INR',
          'completed',
          'recording_access',
          `Full Match & Highlights access for ${g.name}`,
          JSON.stringify({
            unlocked_items: ['full_match', 'highlights'],
            purchased_items: ['full_match', 'highlights'],
          }),
          g.endTime,
        ]
      );

      console.log(`✅ Seeded match: "${g.name}" with ${g.highlights.length} highlights and unlocked media.`);
    }

    console.log('\n--- Seeding Complete for Demo User! ---');
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemoData();
