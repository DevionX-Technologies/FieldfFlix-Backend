/** Gateway highlight keys: highlights/court{N}_cam{M}_{YYYYMMDD-HHMMSS}_highlight.mp4 */

export const HIGHLIGHTS_S3_PREFIX = 'highlights/';

const HIGHLIGHT_KEY_RE =
  /^highlights\/court(\d+)_cam(\d+)_(\d{8})-(\d{6})_highlight\.mp4$/;

export type ParsedHighlightS3Key = {
  key: string;
  court: number;
  nvrCam: number;
  /** Window start encoded in the key (Pi gateway UTC, aligns with S3 LastModified). */
  windowStart: Date;
};

/** Parse timestamp in key as UTC — Botanical Pi keys match upload time in UTC. */
export function parseHighlightKeyTimestamp(
  datePart: string,
  timePart: string,
): Date {
  const year = parseInt(datePart.slice(0, 4), 10);
  const month = parseInt(datePart.slice(4, 6), 10) - 1;
  const day = parseInt(datePart.slice(6, 8), 10);
  const hour = parseInt(timePart.slice(0, 2), 10);
  const minute = parseInt(timePart.slice(2, 4), 10);
  const second = parseInt(timePart.slice(4, 6), 10);
  return new Date(Date.UTC(year, month, day, hour, minute, second));
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

export function buildHighlightPublicUrl(
  key: string,
  bucket = process.env.AWS_S3_BUCKET_NAME || 'fieldflicks-media-assets',
  region = process.env.AWS_S3_REGION || process.env.AWS_REGION || 'eu-north-1',
): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}
