/**
 * Maps camera IDs embedded on already-printed venue QR posters to current DB ids.
 * Only needed when camera rows were re-seeded without preserving primary keys.
 */
const LEGACY_QR_CAMERA_ID_MAP: Record<string, string> = {
  // TSG Pickleball and Sports Arena | Botanical Gardens (printed NEW QRS batch)
  '27ce1af1-721a-421c-9223-3ddeda95f325':
    '4e3ab0bc-d032-46a7-b96f-60c09ad2266f',
  '27ce1af1-721a-421c-9223-3ddeda95f326':
    '020e7fb6-9606-45fa-8cfb-ace502dc34da',
  '27ce1af1-721a-421c-9223-3ddeda95f327':
    '556a921c-3982-41b5-b40f-b01030032a7d',
  '27ce1af1-721a-421c-9223-3ddeda95f328':
    '203033a2-c07e-4541-8072-31db26afc1a5',
  '27ce1af1-721a-421c-9223-3ddeda95f32b':
    'deae8d39-13ba-44eb-92c4-9a365ef96e75',
  '27ce1af1-721a-421c-9223-3ddeda95f32c':
    '85eb21a1-fb43-4444-84fb-e431196e740f',
};

export function resolveLegacyQrCameraId(
  scannedCameraId: string,
): string | null {
  const trimmed = String(scannedCameraId ?? '').trim();
  if (!trimmed) return null;
  return LEGACY_QR_CAMERA_ID_MAP[trimmed] ?? null;
}
