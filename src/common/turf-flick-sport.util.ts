import { ESportsSupported } from 'src/turfs/enum/turfs.enum';

/**
 * Balkanji Bari venues are Pickleball-only in FieldFlix product logic.
 * Legacy `turfs.sports_supported` rows may still list Cricket — we intentionally
 * do not bulk-update those for history; callers pass `turfName` so UX maps here.
 */
export function isOperationalBalkanjiVenueName(
  name: string | null | undefined,
): boolean {
  return typeof name === 'string' && name.toLowerCase().includes('balkanji');
}

/** Maps turf `sports_supported` to FlickShort tab sport (default pickleball). */
export function deriveFlickSportFromTurf(
  supported: ESportsSupported[] | null | undefined,
  turfName?: string | null,
): 'pickleball' | 'padel' | 'cricket' {
  if (isOperationalBalkanjiVenueName(turfName)) {
    return 'pickleball';
  }
  const arr = supported ?? [];
  if (
    arr.includes(ESportsSupported.PICKLEBALL) ||
    arr.includes(ESportsSupported.PICKLE)
  ) {
    return 'pickleball';
  }
  if (arr.includes(ESportsSupported.PADDLE)) {
    return 'padel';
  }
  if (arr.includes(ESportsSupported.CRICKET)) {
    return 'cricket';
  }
  return 'pickleball';
}
