import { ESportsSupported } from 'src/turfs/enum/turfs.enum';

/** Maps turf `sports_supported` to FlickShort tab sport (default pickleball). */
export function deriveFlickSportFromTurf(
  supported: ESportsSupported[] | null | undefined,
): 'pickleball' | 'padel' | 'cricket' {
  const arr = supported ?? [];
  if (arr.includes(ESportsSupported.PICKLEBALL) || arr.includes(ESportsSupported.PICKLE)) {
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
