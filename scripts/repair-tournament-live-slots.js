/**
 * Repairs mis-tagged tournament liveStreams where Botanical NVR cam2
 * was saved under `_ch1` because backend used `channelNumber === 2`.
 *
 * Usage: node scripts/repair-tournament-live-slots.js
 */
const pg = require('pg');

const BOTANICAL_PLAYBACK_TO_SLOT = {
  // Court 3
  JVNeDKDKzeM5hicta4Aj0101fygyBlpN00Rxz3ZPpOEFlo: { court: 3, slot: 1 },
  '5by003TqhFMfsrP0100NHS7hipy4WxJjKSJ01G01023pVyAyA': { court: 3, slot: 2 },
  // Court 4
  J0102TdMq9n3UnEGzVu3kRW4AxgqwWBsdpRN6A2T8fbgU: { court: 4, slot: 1 },
  gnlrEQPVEKKqwcspjdSidYv9c4ocu4JsaBN01Uzsjksw: { court: 4, slot: 2 },
  // Court 5
  Un4RKt37Yl7kMT1TGPpx2ye7x9BKOEn02flHs6tIhXCA: { court: 5, slot: 1 },
  aP00piIFqOmglUbzo2vMM00fcBxPJIF00BZM9QgnTzHTN4: { court: 5, slot: 2 },
};

function playbackIdFromUrl(url) {
  const m = String(url || '').match(/stream\.mux\.com\/([^./]+)/);
  return m ? m[1] : null;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(
    `SELECT id, name, "liveStreams" FROM tournaments WHERE "liveStreams" IS NOT NULL`,
  );

  for (const row of rows) {
    const streams = Array.isArray(row.liveStreams) ? row.liveStreams : [];
    let changed = false;

    const byCourtSlot = new Map();
    for (const s of streams) {
      if (!s.isLive || !s.playbackUrl) continue;
      const pid = playbackIdFromUrl(s.playbackUrl);
      const map = pid ? BOTANICAL_PLAYBACK_TO_SLOT[pid] : null;
      if (!map) continue;

      const baseId = String(s.cameraId).replace(/_ch[12]$/, '');
      const correctId = `${baseId}_ch${map.slot}`;
      if (s.cameraId === correctId) continue;

      byCourtSlot.set(`${map.court}-${map.slot}`, {
        ...s,
        cameraId: correctId,
        cameraName: `Court ${map.court} (Ch ${map.slot})`,
        courtNumber: map.court,
      });
      changed = true;
    }

    if (!changed) continue;

    const next = streams.map((s) => {
      if (!s.isLive || !s.playbackUrl) return s;
      const pid = playbackIdFromUrl(s.playbackUrl);
      const map = pid ? BOTANICAL_PLAYBACK_TO_SLOT[pid] : null;
      if (!map) return s;
      const baseId = String(s.cameraId).replace(/_ch[12]$/, '');
      const correctId = `${baseId}_ch${map.slot}`;
      const fixed = byCourtSlot.get(`${map.court}-${map.slot}`);
      if (fixed && s.cameraId !== correctId) {
        // Clear wrong slot; correct slot gets fixed entry below
        return { ...s, isLive: false, playbackUrl: undefined };
      }
      return s;
    });

    for (const fixed of byCourtSlot.values()) {
      const idx = next.findIndex((s) => s.cameraId === fixed.cameraId);
      if (idx >= 0) next[idx] = { ...next[idx], ...fixed };
      else next.push(fixed);
    }

    await client.query(
      `UPDATE tournaments SET "liveStreams" = $1::jsonb WHERE id = $2`,
      [JSON.stringify(next), row.id],
    );
    console.log('Repaired', row.name, row.id);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
