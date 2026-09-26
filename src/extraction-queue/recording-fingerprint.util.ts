import * as crypto from 'crypto';

/**
 * Generates a deterministic SHA256 fingerprint for a physical video recording.
 * Two extraction requests with the same venue, camera, and time range will
 * always produce the same fingerprint → deduplicated to ONE physical asset.
 *
 * Format: SHA256(venueId:cameraId:startTimeISO:endTimeISO)
 */
export function generateRecordingFingerprint(params: {
  venueId: string;
  cameraId: string;
  startTime: Date | string;
  endTime: Date | string;
}): string {
  const normalizedStart =
    params.startTime instanceof Date
      ? params.startTime.toISOString()
      : new Date(params.startTime).toISOString();

  const normalizedEnd =
    params.endTime instanceof Date
      ? params.endTime.toISOString()
      : new Date(params.endTime).toISOString();

  const raw = [
    params.venueId,
    params.cameraId,
    normalizedStart,
    normalizedEnd,
  ].join(':');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Generates a deterministic, human-readable Cloudflare R2 key.
 * ONE recording = ONE R2 key regardless of how many users request it.
 *
 * Format: recordings/{env}/venues/{venueId}/cameras/{cameraId}/{YYYY}/{MM}/{DD}/{startUtc}_{endUtc}_{fingerprint}.mp4
 */
export function generateR2Key(params: {
  environment: 'dev' | 'prod';
  venueId: string;
  cameraId: string;
  startTime: Date | string;
  endTime: Date | string;
  fingerprint: string;
}): string {
  const start =
    params.startTime instanceof Date
      ? params.startTime
      : new Date(params.startTime);
  const end =
    params.endTime instanceof Date ? params.endTime : new Date(params.endTime);

  const yyyy = start.getUTCFullYear();
  const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(start.getUTCDate()).padStart(2, '0');

  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 15) + 'Z';

  return [
    'recordings',
    params.environment,
    'venues',
    params.venueId,
    'cameras',
    params.cameraId,
    `${yyyy}/${mm}/${dd}`,
    `${fmt(start)}_${fmt(end)}_${params.fingerprint.slice(0, 8)}.mp4`,
  ].join('/');
}
