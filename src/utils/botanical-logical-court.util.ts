/**
 * Botanical Gardens NVR logical court numbers keyed by camera UUID.
 *
 * Production DB `court_number` values can drift from the physical court on QR
 * posters. NVR channel lookup must use the logical court (1–6), not the raw DB
 * column, or extraction pulls the wrong RTSP feed (e.g. court 4 → court 2).
 *
 * Sources: printed QR batch, admin `getChannelForCourt`, audit spreadsheet.
 */
export const BOTANICAL_CAMERA_LOGICAL_COURT: Record<string, number> = {
  // Printed QR ids (legacy)
  '27ce1af1-721a-421c-9223-3ddeda95f325': 3,
  '27ce1af1-721a-421c-9223-3ddeda95f326': 4,
  '27ce1af1-721a-421c-9223-3ddeda95f327': 5,
  '27ce1af1-721a-421c-9223-3ddeda95f328': 6,
  '27ce1af1-721a-421c-9223-3ddeda95f32b': 5,
  '27ce1af1-721a-421c-9223-3ddeda95f32c': 6,
  // Current DB ids (QR remap targets)
  '4e3ab0bc-d032-46a7-b96f-60c09ad2266f': 3,
  '020e7fb6-9606-45fa-8cfb-ace502dc34da': 4,
  '556a921c-3982-41b5-b40f-b01030032a7d': 5,
  '203033a2-c07e-4541-8072-31db26afc1a5': 6,
  'deae8d39-13ba-44eb-92c4-9a365ef96e75': 5,
  '85eb21a1-fb43-4444-84fb-e431196e740f': 6,
};

export function resolveBotanicalLogicalCourtNumber(camera: {
  id: string;
  court_number?: number | null;
}): number {
  const mapped = BOTANICAL_CAMERA_LOGICAL_COURT[camera.id.trim()];
  if (mapped != null && mapped > 0) return mapped;
  const fromDb = Number(camera.court_number);
  return Number.isFinite(fromDb) && fromDb > 0 ? fromDb : 0;
}

export function isBotanicalVenueLabel(turfName?: string | null): boolean {
  return String(turfName ?? '')
    .toLowerCase()
    .includes('botanical');
}
