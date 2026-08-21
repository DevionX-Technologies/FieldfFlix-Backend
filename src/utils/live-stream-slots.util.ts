/**
 * Maps Pi NVR channel numbers to logical live-stream slots (_ch1 / _ch2).
 * Keep in sync with admin-web `getChannelForCourt`.
 */

export type LiveStreamSlot = 1 | 2;

export function stripLiveStreamSuffix(cameraId: string): string {
  return String(cameraId).replace(/_ch[12]$/, '');
}

export function liveStreamCameraId(
  baseCameraId: string,
  slot: LiveStreamSlot,
): string {
  return `${stripLiveStreamSuffix(baseCameraId)}_ch${slot}`;
}

/** Botanical Gardens — NVR channel per court and logical camera slot. */
export function botanicalNvrChannels(
  courtNumber: number,
): { ch1: number; ch2: number } | null {
  switch (courtNumber) {
    case 1:
      return { ch1: 6, ch2: 7 };
    case 2:
      return { ch1: 4, ch2: 12 };
    case 3:
      return { ch1: 8, ch2: 9 };
    case 4:
      return { ch1: 5, ch2: 11 };
    case 5:
      return { ch1: 2, ch2: 3 };
    case 6:
      return { ch1: 1, ch2: 10 };
    default:
      return null;
  }
}

export function isBotanicalPiBaseUrl(baseUrl?: string | null): boolean {
  const url = String(baseUrl ?? '').toLowerCase();
  return url.includes('court17-1') || url.includes('cpu.taild82368.ts.net');
}

/**
 * Resolve which tournament slot (_ch1 vs _ch2) an NVR channel belongs to.
 * Prefer explicit `logicalChannel` from admin; else map via venue court table.
 */
export function resolveLiveStreamSlot(params: {
  nvrChannel: number;
  courtNumber?: number | null;
  raspberryPiBaseUrl?: string | null;
  logicalChannel?: LiveStreamSlot;
}): LiveStreamSlot {
  if (params.logicalChannel === 1 || params.logicalChannel === 2) {
    return params.logicalChannel;
  }

  const courtNumber = params.courtNumber ?? null;
  if (courtNumber != null && isBotanicalPiBaseUrl(params.raspberryPiBaseUrl)) {
    const map = botanicalNvrChannels(courtNumber);
    if (map) {
      if (params.nvrChannel === map.ch2) return 2;
      if (params.nvrChannel === map.ch1) return 1;
    }
  }

  // Non-Botanical venues: NVR channel 2 is the second angle.
  return params.nvrChannel === 2 ? 2 : 1;
}

export function upsertTournamentLiveStream(
  streams: any[],
  entry: {
    cameraId: string;
    cameraName: string;
    courtNumber?: number | null;
    playbackUrl: string;
    liveStreamId?: string;
    isLive: boolean;
  },
): any[] {
  const next = [...streams];
  const idx = next.findIndex((s) => s.cameraId === entry.cameraId);
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...entry };
  } else {
    next.push(entry);
  }
  return next;
}

export function markTournamentLiveStreamOffline(
  streams: any[],
  cameraId: string,
): any[] {
  return streams.map((s) =>
    s.cameraId === cameraId
      ? { ...s, isLive: false, playbackUrl: undefined }
      : s,
  );
}
