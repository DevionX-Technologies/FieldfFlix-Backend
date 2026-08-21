const PRODUCTION_PUBLIC_API = 'https://api.fieldflicks.com';

/** Hostnames that must never appear in athlete-facing share links. */
const LEGACY_SHARE_HOST_SNIPPETS = [
  'onrender.com',
  'render.com',
  'devionx.com',
];

export function resolvePublicAppBaseUrl(configured?: string | null): string {
  const fallback = PRODUCTION_PUBLIC_API;
  const raw = (configured ?? process.env.APP_BASE_URL ?? fallback)
    .trim()
    .replace(/\/+$/, '');

  if (!raw) return fallback;

  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    if (
      LEGACY_SHARE_HOST_SNIPPETS.some((snippet) => hostname.includes(snippet))
    ) {
      return fallback;
    }
    return raw;
  } catch {
    return fallback;
  }
}
