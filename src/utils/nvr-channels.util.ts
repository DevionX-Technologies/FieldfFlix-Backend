import { Camera } from 'src/camera/camera.entity';
import {
  botanicalNvrChannels,
  isBotanicalPiBaseUrl,
  isPickleflowPiBaseUrl,
  pickleflowNvrChannels,
} from 'src/utils/live-stream-slots.util';
import {
  isBotanicalVenueLabel,
  resolveBotanicalLogicalCourtNumber,
} from 'src/utils/botanical-logical-court.util';

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
  camera: Pick<
    Camera,
    'id' | 'name' | 'court_number' | 'raspberryPiBaseUrl'
  > & {
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

  const isBotanical =
    isBotanicalVenueLabel(camera.turf?.name) ||
    isBotanicalPiBaseUrl(camera.raspberryPiBaseUrl);

  if (isBotanical) {
    const courtNumber = resolveBotanicalLogicalCourtNumber(camera);
    const map = botanicalNvrChannels(courtNumber);
    if (map) {
      return [map.ch1, map.ch2];
    }
  }

  const isPickleflow =
    isPickleflowPiBaseUrl(camera.raspberryPiBaseUrl) ||
    /pickleflow/i.test(camera.turf?.name ?? '');

  if (isPickleflow) {
    const courtNumber =
      camera.court_number != null && camera.court_number > 0
        ? camera.court_number
        : 1;
    const map = pickleflowNvrChannels(courtNumber);
    if (map) {
      return [map.ch1, map.ch2];
    }
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
