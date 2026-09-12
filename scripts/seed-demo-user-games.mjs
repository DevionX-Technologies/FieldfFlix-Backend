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
    console.log('--- Connecting to local DB (127.0.0.1:5432) ---');

    // 1. Ensure Demo User 1 exists (+918888888888)
    const demoPhone1 = '+918888888888';
    let user1Res = await client.query('SELECT * FROM users WHERE phone_number = $1', [demoPhone1]);
    let demoUser1 = user1Res.rows[0];

    if (!demoUser1) {
      console.log('Creating Demo User 1...');
      const insertUser1 = await client.query(
        `INSERT INTO users (id, name, phone_number, "singUp_Method", email)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [randomUUID(), 'Demo User 1', demoPhone1, 'PHONE_NUMBER', 'demo1@fieldflicks.com']
      );
      demoUser1 = insertUser1.rows[0];
    } else {
      await client.query('UPDATE users SET name = $1 WHERE id = $2', ['Demo User 1', demoUser1.id]);
    }
    console.log(`Demo User 1: ${demoUser1.name} (${demoUser1.id}, ${demoUser1.phone_number})`);

    // 2. Ensure Demo User 2 exists (+917777777777 / 77777777)
    const demoPhone2 = '+917777777777';
    let user2Res = await client.query('SELECT * FROM users WHERE phone_number = $1', [demoPhone2]);
    let demoUser2 = user2Res.rows[0];

    if (!demoUser2) {
      console.log('Creating Demo User 2...');
      const insertUser2 = await client.query(
        `INSERT INTO users (id, name, phone_number, "singUp_Method", email)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [randomUUID(), 'Demo User 2', demoPhone2, 'PHONE_NUMBER', 'demo2@fieldflicks.com']
      );
      demoUser2 = insertUser2.rows[0];
    } else {
      await client.query('UPDATE users SET name = $1 WHERE id = $2', ['Demo User 2', demoUser2.id]);
    }
    console.log(`Demo User 2: ${demoUser2.name} (${demoUser2.id}, ${demoUser2.phone_number})`);

    // 3. Fetch turfs and cameras
    const turfsRes = await client.query('SELECT * FROM turfs');
    const camerasRes = await client.query('SELECT * FROM cameras');

    if (turfsRes.rows.length === 0 || camerasRes.rows.length === 0) {
      throw new Error('No turfs or cameras found. Run seed-fleet-venues.mjs first.');
    }

    const eskayTurf = turfsRes.rows.find(t => t.name.includes('Eskay')) || turfsRes.rows[0];
    const balkanjiTurf = turfsRes.rows.find(t => t.name.includes('Balkanji')) || turfsRes.rows[1] || turfsRes.rows[0];
    const padelTurf = turfsRes.rows.find(t => t.name.includes('Padel')) || turfsRes.rows[2] || turfsRes.rows[0];
    const pickpadTurf = turfsRes.rows.find(t => t.name.includes('PickPad')) || turfsRes.rows[3] || turfsRes.rows[0];
    const botanicalTurf = turfsRes.rows.find(t => t.name.includes('Botanical')) || turfsRes.rows[4] || turfsRes.rows[0];
    const cricketTurf = turfsRes.rows.find(t => t.name.includes('Santacruz West')) || turfsRes.rows[5] || turfsRes.rows[0];

    const eskayCam = camerasRes.rows.find(c => c.turfId === eskayTurf.id) || camerasRes.rows[0];
    const balkanjiCam = camerasRes.rows.find(c => c.turfId === balkanjiTurf.id) || camerasRes.rows[1] || camerasRes.rows[0];
    const padelCam = camerasRes.rows.find(c => c.turfId === padelTurf.id) || camerasRes.rows[2] || camerasRes.rows[0];
    const pickpadCam = camerasRes.rows.find(c => c.turfId === pickpadTurf.id) || camerasRes.rows[3] || camerasRes.rows[0];
    const botanicalCam = camerasRes.rows.find(c => c.turfId === botanicalTurf.id) || camerasRes.rows[4] || camerasRes.rows[0];
    const cricketCam = camerasRes.rows.find(c => c.turfId === cricketTurf.id) || camerasRes.rows[5] || camerasRes.rows[0];

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

    // Clear old demo payments, recordings, and shared_recordings
    await client.query('DELETE FROM shared_recordings WHERE shared_with_user_id IN ($1, $2)', [demoUser1.id, demoUser2.id]);
    await client.query('DELETE FROM payments WHERE "user_id" IN ($1, $2)', [demoUser1.id, demoUser2.id]);
    await client.query('DELETE FROM recordings WHERE "userId" IN ($1, $2)', [demoUser1.id, demoUser2.id]);
    console.log('Cleared previous demo recordings, payments, and shared recordings.');

    const now = new Date();

    // MATCH DEFINITIONS
    const gamesData = [
      // 1. UNLOCKED MATCH (Dual Camera Angle session)
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Pickleball Masters - Championship Finals',
        turf: eskayTurf,
        camera: eskayCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        video: muxVideos[0],
        status: 'ready',
        isLocked: false,
        extractSessionKey: 'session_eskay_championship_finals_2026',
        cameraLabel: 'Court 1 - Center View',
        unlockedItems: ['full_match', 'highlights'],
        highlights: [
          { title: 'Ace Serve Winner', offset: 320, label: 'Ace' },
          { title: 'Dramatic Kitchen Rally', offset: 950, label: 'Rally' },
          { title: 'Championship Winning Smash', offset: 2100, label: 'Match Point' },
        ],
        shareWithUserId: demoUser2.id, // Shared with Demo User 2!
      },
      // 1b. SIBLING CAMERA for Game 1 (Dual-angle court demo: cameraCount = 2)
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Pickleball Masters - Championship Finals (Baseline Angle)',
        turf: eskayTurf,
        camera: eskayCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        video: muxVideos[1],
        status: 'ready',
        isLocked: false,
        extractSessionKey: 'session_eskay_championship_finals_2026',
        cameraLabel: 'Court 1 - Baseline Cam',
        unlockedItems: ['full_match', 'highlights'],
        highlights: [],
      },
      // 2. UNLOCKED MATCH
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Padel Night Clash - Semi Finals',
        turf: padelTurf,
        camera: padelCam,
        sport: 'Padel',
        startTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        video: muxVideos[1],
        status: 'ready',
        isLocked: false,
        unlockedItems: ['full_match', 'highlights'],
        highlights: [
          { title: 'Backhand Wall Rebound', offset: 410, label: 'Wall Play' },
          { title: 'Drop Volley at the Net', offset: 1280, label: 'Volley' },
        ],
      },
      // 3. PARTIALLY UNLOCKED MATCH (Highlights only, full match locked)
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Sunset Pickleball Doubles',
        turf: balkanjiTurf,
        camera: balkanjiCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        video: muxVideos[2],
        status: 'ready',
        isLocked: false,
        unlockedItems: ['highlights'], // Only highlights unlocked
        highlights: [
          { title: 'Fast Reflex Volley Exchange', offset: 180, label: 'Volley' },
          { title: 'Crosscourt Dinking Masterclass', offset: 840, label: 'Dink' },
        ],
      },
      // 4. LOCKED MATCH (Ready for Checkout / Unlock)
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Botanical Open - Quarter Finals',
        turf: botanicalTurf,
        camera: botanicalCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
        video: muxVideos[3],
        status: 'ready',
        isLocked: true,
        highlights: [
          { title: 'Spin Serve Ace', offset: 210, label: 'Ace' },
          { title: 'Unbelievable Recovery Lob', offset: 1140, label: 'Lob' },
        ],
      },
      // 5. LOCKED MATCH
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Weekend Cricket Cup - Round 1',
        turf: cricketTurf,
        camera: cricketCam,
        sport: 'Cricket',
        startTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        video: muxVideos[0],
        status: 'ready',
        isLocked: true,
        highlights: [
          { title: 'Cover Drive Four', offset: 340, label: 'Boundary' },
          { title: 'Clean Bowled Middle Stump', offset: 1450, label: 'Wicket' },
        ],
      },
      // 6. LOCKED MATCH (PickPad)
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'PickPad Ranked Pro Battle',
        turf: pickpadTurf,
        camera: pickpadCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
        video: muxVideos[1],
        status: 'ready',
        isLocked: true,
        highlights: [
          { title: 'Third Shot Drop Precision', offset: 250, label: 'Drop Shot' },
          { title: 'Down-the-Line Passing Shot', offset: 1120, label: 'Winner' },
        ],
      },
      // 7. FAILED MATCH (Complete extraction failure -> "failed/ admin will update soon")
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Monsoon Smash League - Qualifier',
        turf: balkanjiTurf,
        camera: balkanjiCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        video: null,
        status: 'failed',
        failedMessage: 'Video extraction failed: Stream timeout during recording',
        isLocked: true,
        highlights: [],
      },
      // 8. FAILED MATCH WITH HIGHLIGHTS (Partial failure -> "Highlights fetched" + "failed/ admin will update soon")
      {
        id: randomUUID(),
        userId: demoUser1.id,
        name: 'Under-Floodlights Pickleball Clash',
        turf: eskayTurf,
        camera: eskayCam,
        sport: 'Pickleball',
        startTime: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000 - 3600 * 1000),
        endTime: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
        video: null,
        status: 'failed',
        failedMessage: 'Full match video encoding corrupted; 2 highlight clips recovered',
        isLocked: false,
        unlockedItems: ['highlights'],
        highlights: [
          { title: 'Power Overhead Smash', offset: 190, label: 'Smash', playbackId: muxVideos[2].playbackId },
          { title: 'ATP Around The Post Winner', offset: 670, label: 'ATP', playbackId: muxVideos[3].playbackId },
        ],
      },
      // 9. MATCH HOSTED BY DEMO USER 2 (Shared back with Demo User 1)
      {
        id: randomUUID(),
        userId: demoUser2.id,
        name: 'Padel Super Series - Exhibition Match',
        turf: padelTurf,
        camera: padelCam,
        sport: 'Padel',
        startTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 - 1800 * 1000),
        endTime: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        video: muxVideos[2],
        status: 'ready',
        isLocked: false,
        unlockedItems: ['full_match', 'highlights'],
        highlights: [
          { title: 'Vibora Angle Winner', offset: 310, label: 'Vibora' },
          { title: 'Bandeja Deep Defense', offset: 890, label: 'Bandeja' },
        ],
        shareWithUserId: demoUser1.id, // Shared with Demo User 1!
      },
    ];

    for (const g of gamesData) {
      const recordingId = g.id;
      const metadata = {
        fieldflix_session_sport: g.sport,
        court_number: g.camera.court_number,
        camera_label: g.cameraLabel || g.camera.name,
        plannedDurationSec: 3600,
        unlocked: !g.isLocked,
        extract_session_key: g.extractSessionKey,
        ...(g.failedMessage ? { failed_message: g.failedMessage } : {}),
      };

      const hasVideo = !!g.video;
      const assetId = hasVideo ? g.video.assetId : null;
      const playbackId = hasVideo ? g.video.playbackId : null;
      const mediaUrl = hasVideo ? `https://stream.mux.com/${g.video.playbackId}.m3u8` : null;

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
          g.userId,
          g.turf.id,
          g.camera.id,
          g.startTime,
          g.endTime,
          g.status,
          g.name,
          assetId,
          playbackId,
          mediaUrl,
          JSON.stringify(metadata),
          !g.isLocked && g.status === 'ready',
          hasVideo,
        ]
      );

      // 2. Insert Highlights
      for (const h of g.highlights) {
        const highlightId = randomUUID();
        const clickTime = new Date(g.startTime.getTime() + h.offset * 1000);
        const relTime = new Date(h.offset * 1000).toISOString().substring(11, 19);
        const hPlaybackId = h.playbackId || (hasVideo ? g.video.playbackId : muxVideos[0].playbackId);

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
            hPlaybackId,
            `https://stream.mux.com/${hPlaybackId}.m3u8`,
            JSON.stringify({
              title: h.title,
              label: h.label,
              highlight_title: h.title,
              duration: 30,
              thumbnailUrl: `https://image.mux.com/${hPlaybackId}/thumbnail.jpg`,
            }),
          ]
        );
      }

      // 3. Insert Payment
      const paymentId = randomUUID();
      if (!g.isLocked) {
        await client.query(
          `INSERT INTO payments (
            id, user_id, recording_id, razorpay_order_id, razorpay_payment_id,
            amount, base_amount, currency, status, payment_type,
            description, metadata, paid_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            paymentId,
            g.userId,
            recordingId,
            `order_demo_${recordingId.slice(0, 8)}`,
            `pay_demo_${recordingId.slice(0, 8)}`,
            240.00,
            240.00,
            'INR',
            'completed',
            'recording_access',
            `Unlocked media access for ${g.name}`,
            JSON.stringify({
              unlocked_items: g.unlockedItems || ['full_match', 'highlights'],
              purchased_items: g.unlockedItems || ['full_match', 'highlights'],
            }),
            g.endTime,
          ]
        );
        console.log(`✅ Seeded UNLOCKED match: "${g.name}" (Status: ${g.status})`);
      } else if (g.status === 'failed') {
        console.log(`⚠️ Seeded FAILED match: "${g.name}" (Status: failed, Highlights: ${g.highlights.length})`);
      } else {
        await client.query(
          `INSERT INTO payments (
            id, user_id, recording_id, razorpay_order_id,
            amount, base_amount, currency, status, payment_type,
            description, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            paymentId,
            g.userId,
            recordingId,
            `order_pending_${recordingId.slice(0, 8)}`,
            240.00,
            240.00,
            'INR',
            'pending',
            'recording_access',
            `Pending unlock for ${g.name}`,
            JSON.stringify({
              unlocked_items: [],
              purchased_items: [],
            }),
          ]
        );
        console.log(`🔒 Seeded LOCKED match: "${g.name}" (Status: Locked, Price: ₹240)`);
      }

      // 4. Match Sharing (if specified)
      if (g.shareWithUserId) {
        const sharedId = randomUUID();
        await client.query(
          `INSERT INTO shared_recordings (
            id, recording_id, shared_with_user_id, created_at, updated_at
          ) VALUES ($1, $2, $3, NOW(), NOW())`,
          [sharedId, recordingId, g.shareWithUserId]
        );
        console.log(`🤝 Shared match "${g.name}" with user ${g.shareWithUserId}`);
      }
    }

    console.log('\n--- Seeding Complete! ---');
    console.log(`Demo User 1: ${demoUser1.phone_number} / OTP: 123456`);
    console.log(`Demo User 2: ${demoUser2.phone_number} (or 77777777) / OTP: 123456`);
  } catch (err) {
    console.error('Seeding error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemoData();
