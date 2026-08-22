/**
 * Hardcoded Mux live-stream keys for Botanical Gardens NVR channels.
 * Playback IDs verified against Mux API (2026-08-22) — typos in NVR 3/10
 * caused 404s (l vs L, f vs F).
 */
export type BotanicalMuxKey = {
  streamKey: string;
  playbackId: string;
};

export const BOTANICAL_MUX_KEYS: Record<number, BotanicalMuxKey> = {
  1: {
    streamKey: '1c745972-a169-3a16-2676-c4f254ea8511',
    playbackId: 'UBbR4q9RqgBFwC6APiHAsOWGuawZJ5x02bywXJBeTnV8',
  },
  2: {
    streamKey: '62a93d81-6798-06cc-1c42-fe0a60fa9465',
    playbackId: 'Un4RKt37Yl7kMT1TGPpx2ye7x9BKOEn02flHs6tIhXCA',
  },
  3: {
    streamKey: '59db2aa9-d1d9-8d52-5e67-ea67428b6624',
    playbackId: 'aP00piIFqOmglUbzo2vMM00fcBxPJIF00BZM9QgnTzHTN4',
  },
  5: {
    streamKey: '036ce09f-6d8f-3d52-b80d-3c6fb5656f53',
    playbackId: 'J0102TdMq9n3UnEGzVu3kRW4AxgqwWBsdpRN6A2T8fbgU',
  },
  8: {
    streamKey: '5fde67eb-216d-88a2-bb62-d97cbb40329a',
    playbackId: 'JVNeDKDKzeM5hicta4Aj0101fygyBlpN00Rxz3ZPpOEFlo',
  },
  9: {
    streamKey: 'd9e08a81-f71c-a92d-b423-aafe4014b4de',
    playbackId: '5by003TqhFMfsrP0100NHS7hipy4WxJjKSJ01G01023pVyAyA',
  },
  10: {
    streamKey: '94b0b075-3935-068e-5f9f-09f13fd248b8',
    playbackId: '00wcJWg00HQfOojDDbDHEM7C600W4Frsqj00B01mNz2c4i7s',
  },
  11: {
    streamKey: 'cc87e8ef-e65a-9d22-a34c-536c51ee70ae',
    playbackId: 'gnlrEQPVEKKqwcspjdSidYv9c4ocu4JsaBN01Uzsjksw',
  },
};

export function getBotanicalMuxKey(nvrChannel: number): BotanicalMuxKey | null {
  return BOTANICAL_MUX_KEYS[nvrChannel] ?? null;
}
