/** Parse relative_timestamp ("m:ss" or "h:mm:ss") to seconds for Mux thumbnail ?time=. */
export function parseRelativeTimestampToSeconds(
  ts: string | null | undefined,
): number | null {
  const raw = String(ts ?? '').trim();
  if (!raw) return null;

  const parts = raw.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return null;
}

export function muxHighlightThumbnailUrl(
  playbackId: string | null | undefined,
  timeSeconds = 2,
): string | null {
  const id = String(playbackId ?? '').trim();
  if (!id) return null;
  const t = Math.max(0, Math.floor(timeSeconds));
  return `https://image.mux.com/${id}/thumbnail.jpg?time=${t}`;
}

export function resolveHighlightThumbnailUrl(input: {
  playback_id?: string | null;
  relative_timestamp?: string | null;
  parent_mux_playback_id?: string | null;
}): string | null {
  const clipPlaybackId = String(input.playback_id ?? '').trim();
  if (clipPlaybackId) {
    return muxHighlightThumbnailUrl(clipPlaybackId, 2);
  }

  const parentMux = String(input.parent_mux_playback_id ?? '').trim();
  const relativeSeconds = parseRelativeTimestampToSeconds(
    input.relative_timestamp,
  );
  if (parentMux && relativeSeconds != null) {
    return muxHighlightThumbnailUrl(parentMux, relativeSeconds);
  }

  return null;
}
