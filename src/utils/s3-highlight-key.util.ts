/** Gateway highlight keys: highlights/court{N}_cam{M}_{YYYYMMDD-HHMMSS}_highlight.mp4 */

export const HIGHLIGHTS_S3_PREFIX = 'highlights/';

const HIGHLIGHT_KEY_RE =
  /^highlights\/court(\d+)_cam(\d+)_(\d{8})-(\d{6})_highlight\.mp4$/;

export type ParsedHighlightS3Key = {
  key: string;
  court: number;
  nvrCam: number;
  /** Window start encoded in the key (Pi gateway UTC wall clock). */
  windowStart: Date;
};

/** Parse timestamp in key as UTC — Pi gateway encodes UTC in S3 object keys. */
export function parseHighlightKeyTimestamp(
  datePart: string,
  timePart: string,
): Date {
  const year = datePart.slice(0, 4);
  const month = datePart.slice(4, 6);
  const day = datePart.slice(6, 8);
  const hour = timePart.slice(0, 2);
  const minute = timePart.slice(2, 4);
  const second = timePart.slice(4, 6);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

export function parseHighlightS3Key(key: string): ParsedHighlightS3Key | null {
  const match = HIGHLIGHT_KEY_RE.exec(key);
  if (!match) return null;
  const [, courtStr, camStr, datePart, timePart] = match;
  return {
    key,
    court: parseInt(courtStr, 10),
    nvrCam: parseInt(camStr, 10),
    windowStart: parseHighlightKeyTimestamp(datePart, timePart),
  };
}

export function highlightCourtCamPrefix(court: number, nvrCam: number): string {
  return `${HIGHLIGHTS_S3_PREFIX}court${court}_cam${nvrCam}_`;
}

export function getHighlightS3Bucket(): string {
  return process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets';
}

/** S3 object region — do not use AWS_REGION (often the ECS/Lambda region). */
export function getHighlightS3Region(): string {
  return process.env.AWS_S3_REGION || 'eu-north-1';
}

export function buildHighlightPublicUrl(
  key: string,
  bucket = getHighlightS3Bucket(),
  region = getHighlightS3Region(),
): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}

function extractKeyFromS3Url(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return path || null;
  } catch {
    return null;
  }
}

/** Rewrite bucket URLs that used AWS_REGION instead of the S3 bucket region. */
export function normalizeS3HighlightUrl(
  url: string,
  s3path?: string | null,
): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith('http')) return trimmed;

  const bucket = getHighlightS3Bucket();
  const region = getHighlightS3Region();
  if (!trimmed.includes(`${bucket}.s3.`)) return trimmed;
  if (trimmed.includes(`.s3.${region}.amazonaws.com`)) return trimmed;

  const key = s3path?.trim() || extractKeyFromS3Url(trimmed);
  if (key && !key.startsWith('http')) {
    return buildHighlightPublicUrl(key);
  }

  return trimmed.replace(
    /\.s3\.[^.]+\.amazonaws\.com/,
    `.s3.${region}.amazonaws.com`,
  );
}

export function muxHighlightHlsUrl(playbackId?: string | null): string | null {
  const id = playbackId?.trim();
  return id ? `https://stream.mux.com/${id}.m3u8` : null;
}

/** Best playable stream URL for a highlight row (Mux preferred over S3). */
export function resolveHighlightStreamUrl(highlight: {
  playback_id?: string | null;
  mux_public_playback_url?: string | null;
  s3path?: string | null;
}): string | null {
  const muxUrl = muxHighlightHlsUrl(highlight.playback_id);
  if (muxUrl) return muxUrl;

  const stored = highlight.mux_public_playback_url?.trim();
  if (stored?.startsWith('http')) {
    if (stored.includes('stream.mux.com')) return stored;
    return normalizeS3HighlightUrl(stored, highlight.s3path);
  }

  const s3path = highlight.s3path?.trim();
  if (!s3path) return null;
  if (s3path.startsWith('http')) {
    return normalizeS3HighlightUrl(s3path);
  }
  return buildHighlightPublicUrl(s3path);
}
