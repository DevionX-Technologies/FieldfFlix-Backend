/**
 * Builds Cloudflare Stream playback URLs.
 *
 * Honours `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN` so the account's own
 * delivery domain is used when configured, and falls back to the shared
 * `videodelivery.net` host otherwise. Replaces hardcoded per-account
 * subdomains that were previously inlined in controllers and services.
 */

function getStreamHost(): string {
  const configured = (
    process.env.CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN || ''
  ).trim();
  if (!configured) return 'https://videodelivery.net';

  const host = configured.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${host}`;
}

/** HLS master manifest URL for an asset UID or a signed playback token. */
export function buildStreamHlsUrl(
  uidOrToken: string | null | undefined,
): string | null {
  const id = String(uidOrToken ?? '').trim();
  if (!id) return null;
  if (/^https?:\/\//i.test(id)) return id;
  return `${getStreamHost()}/${id}/manifest/video.m3u8`;
}

/** Poster/thumbnail URL for an asset UID or a signed playback token. */
export function buildStreamThumbnailUrl(
  uidOrToken: string | null | undefined,
  timeSeconds?: number,
): string | null {
  const id = String(uidOrToken ?? '').trim();
  if (!id) return null;
  const base = /^https?:\/\//i.test(id)
    ? id.replace(/\/+$/, '')
    : `${getStreamHost()}/${id}/thumbnails/thumbnail.jpg`;
  if (timeSeconds === undefined || timeSeconds === null) return base;
  return `${base}?time=${Math.max(0, Math.floor(timeSeconds))}s`;
}

/**
 * True when a persisted playback id looks like a Cloudflare Stream UID rather
 * than a Mux playback id. Stream UIDs are 32 lowercase hex characters.
 */
export function isCloudflareStreamUid(value: unknown): boolean {
  return /^[a-f0-9]{32}$/i.test(String(value ?? '').trim());
}
