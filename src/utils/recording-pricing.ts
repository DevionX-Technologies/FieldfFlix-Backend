/**
 * Recording unlock pricing — half-hourly rate, billed in 30-minute blocks.
 * Any session from 1 second up to 30 minutes costs one block; 31 minutes costs two, etc.
 */

import { ESportsSupported } from 'src/turfs/enum/turfs.enum';
import { PricingConfigEntity } from 'src/payment/entities/pricing-config.entity';

export type RecordingUnlockSport = 'cricket' | 'pickleball' | 'padel';

export const HALF_HOUR_SEC = 30 * 60;

/** @deprecated Billing uses half-hour blocks; kept for legacy imports. */
export const HOUR_SEC = HALF_HOUR_SEC * 2;

export function halfHourBlocksFromDuration(plannedDurationSec: number): number {
  const sec = Math.max(1, Math.floor(plannedDurationSec));
  return Math.max(1, Math.ceil(sec / HALF_HOUR_SEC));
}

/** @deprecated Use halfHourBlocksFromDuration */
export function hourlyBlocksFromDuration(plannedDurationSec: number): number {
  return halfHourBlocksFromDuration(plannedDurationSec);
}

function halfHourlyRateForTier(
  tier: RecordingUnlockSport,
  config: PricingConfigEntity,
): number {
  if (tier === 'cricket') {
    return Number(
      config.cricket_half_hourly_rate ?? config.cricket_hourly_rate / 2,
    );
  }
  if (tier === 'pickleball') {
    return Number(
      config.pickleball_half_hourly_rate ?? config.pickleball_hourly_rate / 2,
    );
  }
  if (tier === 'padel') {
    return Number(
      config.padel_half_hourly_rate ?? config.padel_hourly_rate / 2,
    );
  }
  return Number(
    config.default_half_hourly_rate ?? config.default_hourly_rate / 2,
  );
}

/** Pre-tax total. */
export function recordingUnlockBaseInr(
  tier: RecordingUnlockSport,
  plannedDurationSec: number,
  config: PricingConfigEntity,
): number {
  const halfHourlyRate = halfHourlyRateForTier(tier, config);
  const blocks = halfHourBlocksFromDuration(plannedDurationSec);
  return Math.round(blocks * halfHourlyRate);
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
