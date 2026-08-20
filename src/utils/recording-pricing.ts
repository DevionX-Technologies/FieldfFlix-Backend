/**
 * Recording unlock pricing — hourly rate, billed in 30-minute blocks.
 * Fetches configuration from the database via PricingConfigService.
 */

import { ESportsSupported } from 'src/turfs/enum/turfs.enum';
import { PricingConfigEntity } from 'src/payment/entities/pricing-config.entity';

export type RecordingUnlockSport = 'cricket' | 'pickleball' | 'padel';

export const HALF_HOUR_SEC = 30 * 60;

export function halfHourBlocksFromDuration(plannedDurationSec: number): number {
  const sec = Math.max(HALF_HOUR_SEC, Math.floor(plannedDurationSec));
  return Math.max(1, Math.round(sec / HALF_HOUR_SEC));
}

/** Pre-tax total. */
export function recordingUnlockBaseInr(
  tier: RecordingUnlockSport,
  plannedDurationSec: number,
  config: PricingConfigEntity,
): number {
  let hourlyRate = config.default_hourly_rate;
  if (tier === 'cricket') {
    hourlyRate = config.cricket_hourly_rate;
  } else if (tier === 'pickleball') {
    hourlyRate = config.pickleball_hourly_rate;
  } else if (tier === 'padel') {
    hourlyRate = config.padel_hourly_rate;
  }

  const halfHourRate = hourlyRate / 2;
  const blocks = halfHourBlocksFromDuration(plannedDurationSec);
  return Math.round(blocks * halfHourRate);
}

export function recordingUnlockTotalInr(
  base: number,
  config: PricingConfigEntity,
): number {
  if (base <= 0) return 0;
  return Math.round(base * (1 + config.gst_rate));
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
