import { Camera } from 'src/camera/camera.entity';

const PICKPAD_PATTERN = /pick\s*pad|pickpad|aim sports/i;

function parseDualChannelCameraIds(): Set<string> {
  const raw = process.env.DUAL_CHANNEL_CAMERA_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * NVR RTSP channels to extract for a court camera.
 * Most venues use one channel (= court_number). Dual-channel courts (e.g. PickPad)
 * share one Pi with NVR channels 1 and 2.
 */
export function resolveNvrChannelsForCamera(
  camera: Pick<Camera, 'id' | 'name' | 'court_number'> & {
    turf?: { name?: string | null } | null;
  },
): number[] {
  const dualChannelCameraIds = parseDualChannelCameraIds();
  if (dualChannelCameraIds.has(camera.id)) {
    return [1, 2];
  }

  const label = `${camera.turf?.name ?? ''} ${camera.name ?? ''}`;
  if (PICKPAD_PATTERN.test(label)) {
    return [1, 2];
  }

  const defaultChannel =
    camera.court_number != null && camera.court_number > 0
      ? camera.court_number
      : 1;

  return [defaultChannel];
}

export function readRecordingNvrChannel(
  metadata: Record<string, unknown> | null | undefined,
  fallback = 1,
): number {
  const raw = metadata?.nvr_channel ?? metadata?.nvrChannel;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
