import { PaymentType } from 'src/payment/entities/payment.entity';

export type UnlockItem = 'highlights' | 'shorts' | 'full_match';

const VALID_ITEMS = new Set<UnlockItem>(['highlights', 'shorts', 'full_match']);

/** Normalize checkout / client item keys to a canonical unlock item. */
export function normalizeUnlockItem(raw?: string | null): UnlockItem {
  const value = String(raw || 'full_match')
    .trim()
    .toLowerCase();
  if (value === 'highlights' || value === 'highlight') return 'highlights';
  if (value === 'shorts' || value === 'timeline' || value === 'reels') {
    return 'shorts';
  }
  if (value === 'full_match' || value === 'video' || value === 'recording') {
    return 'full_match';
  }
  return 'full_match';
}

export function paymentTypeForUnlockItem(item: UnlockItem): PaymentType {
  if (item === 'highlights') return PaymentType.HIGHLIGHT_ACCESS;
  if (item === 'shorts') return PaymentType.MEDIA_ACCESS;
  return PaymentType.RECORDING_ACCESS;
}

/** Legacy rows without metadata.unlocked_item unlocked the whole bundle. */
export function unlockItemsFromPaymentMetadata(
  metadata: unknown,
): UnlockItem[] {
  if (!metadata || typeof metadata !== 'object') {
    return ['highlights', 'shorts', 'full_match'];
  }
  const meta = metadata as Record<string, unknown>;
  const raw =
    meta.unlocked_item ?? meta.unlock_item ?? meta.item ?? meta.media_item;
  if (typeof raw === 'string' && raw.trim()) {
    const item = normalizeUnlockItem(raw);
    return VALID_ITEMS.has(item) ? [item] : ['full_match'];
  }
  return ['highlights', 'shorts', 'full_match'];
}

export function mergeUnlockItems(...lists: UnlockItem[][]): UnlockItem[] {
  const merged = new Set<UnlockItem>();
  for (const list of lists) {
    for (const item of list) merged.add(item);
  }
  return [...merged];
}
