/**
 * Recording unlock pricing — hourly rate, billed in full-hour blocks.
 * Any session from 1 second up to 1 hour costs 1 hour; 61 minutes costs 2 hours, etc.
 */

import { ESportsSupported } from 'src/turfs/enum/turfs.enum';
import { PricingConfigEntity } from 'src/payment/entities/pricing-config.entity';

export type RecordingUnlockSport = 'cricket' | 'pickleball' | 'padel';

export const HOUR_SEC = 60 * 60;

/** @deprecated Use HOUR_SEC — kept for imports that still reference the old default. */
export const HALF_HOUR_SEC = HOUR_SEC;

export function hourlyBlocksFromDuration(plannedDurationSec: number): number {
  const sec = Math.max(1, Math.floor(plannedDurationSec));
  return Math.max(1, Math.ceil(sec / HOUR_SEC));
}

/** @deprecated Use hourlyBlocksFromDuration */
export function halfHourBlocksFromDuration(plannedDurationSec: number): number {
  return hourlyBlocksFromDuration(plannedDurationSec);
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

  const blocks = hourlyBlocksFromDuration(plannedDurationSec);
  return Math.round(blocks * hourlyRate);
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
  if (!Number.isFinite(n) || n <= 0) return null;
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
