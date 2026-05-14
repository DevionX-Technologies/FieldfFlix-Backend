/**
 * Mux GET /video/v1/assets/:id returns `static_renditions` as an object
 * `{ status, files: [...] }`, not a top-level array. See Mux API "Assets".
 */

export function muxStaticRenditionFileRows(staticRenditions: unknown): unknown[] {
  if (Array.isArray(staticRenditions)) {
    return staticRenditions;
  }
  if (
    staticRenditions &&
    typeof staticRenditions === 'object' &&
    Array.isArray((staticRenditions as { files?: unknown[] }).files)
  ) {
    return (staticRenditions as { files: unknown[] }).files;
  }
  return [];
}

export function muxStaticRenditionsBucketStatus(
  staticRenditions: unknown,
): string {
  if (
    staticRenditions &&
    typeof staticRenditions === 'object' &&
    !Array.isArray(staticRenditions)
  ) {
    const s = (staticRenditions as { status?: unknown }).status;
    if (s != null && String(s) !== '') {
      return String(s);
    }
  }
  return '';
}

/** POST /static-renditions returns 400 when duplicate "highest" was already requested. */
export function muxIsStaticRenditionAlreadyDefinedResponse(
  data: unknown,
): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const messages = (data as { error?: { messages?: unknown } }).error
    ?.messages;
  if (!Array.isArray(messages)) {
    return false;
  }
  return messages.some(
    (m) =>
      typeof m === 'string' &&
      /static rendition already defined/i.test(m),
  );
}
