/**
 * Resolves direct, unsigned, publicly reachable HTTPS URLs for R2 objects.
 *
 * Why this exists: AWS SDK v3 >= 3.729 signs `x-amz-checksum-mode` into
 * `X-Amz-SignedHeaders` when presigning GetObject. R2 rejects such a URL unless
 * the client echoes that exact header back, which `expo-video` never does —
 * so every presigned GET 403s with SignatureDoesNotMatch. Serving the object
 * from the bucket's public r2.dev (or custom) domain sidesteps signing
 * entirely and keeps HTTP Range / seeking intact for progressive MP4.
 *
 * Presigned URLs remain supported as a fallback via
 * `CloudflareR2StorageAdapter.generateDownloadPresignedUrl`.
 */

/** Strips scheme, trailing slashes and any trailing `/bucket` segment. */
function normalizeBase(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let host: string;
  try {
    host = new URL(withScheme).host;
  } catch {
    return null;
  }

  // A custom domain may be configured with the bucket appended; the public
  // bucket URL format is always `<host>/<key>`.
  const bucket = (process.env.CLOUDFLARE_R2_BUCKET_NAME || '').trim();
  if (bucket && host.toLowerCase().endsWith(`.${bucket.toLowerCase()}`)) {
    host = host.slice(0, -(bucket.length + 1));
  }

  return `https://${host}`;
}

/**
 * Public base URL for R2 objects, e.g. `https://pub-xxxx.r2.dev`.
 * Returns null when no public delivery domain is configured.
 */
export function getR2PublicBaseUrl(): string | null {
  const configured =
    process.env.CLOUDFLARE_R2_PUBLIC_URL ||
    process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN ||
    '';
  return normalizeBase(configured);
}

/** True when the bucket is reachable over an unauthenticated public URL. */
export function isR2PublicDeliveryEnabled(): boolean {
  return getR2PublicBaseUrl() !== null;
}

/** Percent-encodes each path segment while preserving `/` separators. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Builds a direct public URL for an R2 object key.
 * Returns null when public delivery is not configured or the key is empty,
 * so callers can fall back to a presigned URL.
 */
export function buildR2PublicUrl(
  key: string | null | undefined,
): string | null {
  const base = getR2PublicBaseUrl();
  if (!base) return null;

  const normalized = String(key || '')
    .trim()
    .replace(/^(s3|r2):\/\/[^/]+\//, '')
    .replace(/^\/+/, '');
  if (!normalized) return null;

  return `${base}/${encodeKey(normalized)}`;
}

/**
 * Extracts an object key from any of the persisted path shapes:
 * `recordings/x.mp4`, `r2://bucket/recordings/x.mp4`, `s3://bucket/...`,
 * or a fully-qualified URL.
 */
export function extractR2ObjectKey(
  path: string | null | undefined,
): string | null {
  const raw = String(path || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const base = getR2PublicBaseUrl();
      const url = new URL(raw);
      if (base) {
        const baseHost = new URL(base).host.toLowerCase();
        if (url.host.toLowerCase() === baseHost) {
          return url.pathname.replace(/^\/+/, '') || null;
        }
      }
      const marker = url.pathname.indexOf('/');
      return marker >= 0 ? url.pathname.slice(marker + 1) : url.pathname;
    } catch {
      return null;
    }
  }

  return raw.replace(/^(s3|r2):\/\/[^/]+\//, '').replace(/^\/+/, '') || null;
}
