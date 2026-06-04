/**
 * Recording unlock pricing — hourly rate, billed in 30-minute blocks.
 * Keep aligned with mobile `utils/sportPlanPricing.ts`.
 */

import { ESportsSupported } from 'src/turfs/enum/turfs.enum';

export const RECORDING_UNLOCK_GST_RATE = 0.18;

export const SPORT_HOURLY_RATE_INR = {
  cricket: 300,
  pickleball: 200,
  padel: 250,
} as const;

export type RecordingUnlockSport = keyof typeof SPORT_HOURLY_RATE_INR;

export const HALF_HOUR_SEC = 30 * 60;

/** @deprecated Use sport + duration helpers — 30-min minimum base for legacy imports. */
export const RECORDING_UNLOCK_BASE_INR = {
  cricket: 0,
  pickleball: SPORT_HOURLY_RATE_INR.pickleball,
  padel: SPORT_HOURLY_RATE_INR.padel,
} as const;

export function halfHourBlocksFromDuration(plannedDurationSec: number): number {
  const sec = Math.max(HALF_HOUR_SEC, Math.floor(plannedDurationSec));
  return Math.max(1, Math.round(sec / HALF_HOUR_SEC));
}

/** Pre-tax total. Cricket unlock is free for now. */
export function recordingUnlockBaseInr(
  tier: RecordingUnlockSport,
  plannedDurationSec: number,
): number {
  if (tier === 'cricket') return 0;
  const hourly = SPORT_HOURLY_RATE_INR[tier];
  const blocks = halfHourBlocksFromDuration(plannedDurationSec);
  const incrementPerHalfHour = hourly / 2;
  return Math.round(hourly + (blocks - 1) * incrementPerHalfHour);
}

export function recordingUnlockTotalInr(base: number): number {
  if (base <= 0) return 0;
  return Math.round(base * (1 + RECORDING_UNLOCK_GST_RATE));
}

export function parsePlannedDurationSecFromMetadata(
  metadata: unknown,
): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)
    .fieldflix_planned_duration_sec;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < HALF_HOUR_SEC) return null;
  return Math.floor(n);
}

/** Sport tier for unlock pricing — mirrors mobile `homeSportPlanFromRecording`. */
export function resolveUnlockTierFromRecording(recording: {
  metadata?: unknown;
  turf?: { sports_supported?: string[] | null } | null;
}): RecordingUnlockSport {
  const meta = recording.metadata;
  const sessionSport =
    meta && typeof meta === 'object' && 'fieldflix_session_sport' in meta
      ? (meta as { fieldflix_session_sport?: string }).fieldflix_session_sport
      : null;
  if (
    sessionSport === 'cricket' ||
    sessionSport === 'pickleball' ||
    sessionSport === 'padel'
  ) {
    return sessionSport;
  }
  const sp = recording.turf?.sports_supported ?? [];
  const hasCricket = sp.includes(ESportsSupported.CRICKET);
  const hasPickle = sp.some(
    (x) => x === ESportsSupported.PICKLEBALL || x === ESportsSupported.PICKLE,
  );
  const hasPaddle = sp.includes(ESportsSupported.PADDLE);
  const n = Number(hasCricket) + Number(hasPickle) + Number(hasPaddle);
  if (n === 1) {
    if (hasCricket) return 'cricket';
    if (hasPaddle) return 'padel';
    if (hasPickle) return 'pickleball';
  }
  return 'pickleball';
}
