/**
 * Hardcoded Mux live-stream keys for Botanical Gardens NVR channels.
 * Channels 3 and 10 are omitted — those playback IDs were never provisioned in Mux
 * (always 404). Start live stream falls back to dynamic Mux creation for them.
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
  11: {
    streamKey: 'cc87e8ef-e65a-9d22-a34c-536c51ee70ae',
    playbackId: 'gnlrEQPVEKKqwcspjdSidYv9c4ocu4JsaBN01Uzsjksw',
  },
};

export function getBotanicalMuxKey(nvrChannel: number): BotanicalMuxKey | null {
  return BOTANICAL_MUX_KEYS[nvrChannel] ?? null;
}
