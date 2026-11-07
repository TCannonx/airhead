import type { Item, ItemType } from '../schemas/records';
import { baseRecord, newItem, save, update } from './repository';
import type { AirheadDb } from './db';
import { disableRuleForCapture } from './memory';

export const TRASH_DAYS = 30;

export const TYPE_LABELS: Record<ItemType, string> = {
  task: 'Task',
  event: 'Event',
  reading: 'Reading',
  idea: 'Idea',
  meeting: 'Meeting',
  note: 'Note',
  list_entry: 'List entry',
};

/** Types offered when sorting by hand (list entries come with lists in Phase 3). */
export const SORTABLE_TYPES: ItemType[] = ['task', 'event', 'reading', 'idea', 'meeting', 'note'];

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

async function recordCorrection(
  db: AirheadDb,
  userId: string,
  captureId: string | null,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
) {
  await save(db, 'corrections', {
    ...baseRecord(userId),
    capture_id: captureId,
    from_value: from,
    to_value: to,
  });
}

/** Sorts a capture by hand: creates the item, marks the capture sorted, records a correction. */
export async function sortCaptureAs(
  db: AirheadDb,
  userId: string,
  captureId: string,
  type: ItemType,
): Promise<Item | undefined> {
  const capture = await db.captures.get(captureId);
  if (!capture) return undefined;
  const item = await save(
    db,
    'items',
    newItem(userId, {
      type,
      title: capitalise((capture.text ?? capture.url ?? '').split('\n')[0]?.trim() ?? ''),
      body: capture.text && capture.text.includes('\n') ? capture.text : null,
      capture_id: capture.id,
      calendar: type === 'event' ? 'personal' : null,
      data: capture.url ? { url: capture.url } : {},
    }),
  );
  await update(db, 'captures', capture.id, {
    status: 'sorted',
    sorted_at: new Date().toISOString(),
  });
  await recordCorrection(db, userId, capture.id, { status: capture.status }, { type });
  return item;
}

/** Re-sorts an item to another type, recording the correction for future sorting. */
export async function changeItemType(
  db: AirheadDb,
  userId: string,
  itemId: string,
  type: ItemType,
  /** Other changes made in the same write (e.g. status). */
  extra: Partial<Item> = {},
): Promise<Item | undefined> {
  const item = await db.items.get(itemId);
  if (!item) return item;
  if (item.type === type)
    return Object.keys(extra).length ? update(db, 'items', itemId, extra) : item;
  const changed = await update(db, 'items', itemId, {
    ...extra,
    type,
    calendar: type === 'event' ? (item.calendar ?? 'personal') : item.calendar,
  });
  await recordCorrection(db, userId, item.capture_id, { type: item.type }, { type });
  // A correction against a learned rule switches that rule off.
  await disableRuleForCapture(db, item.capture_id);
  return changed;
}

export interface LibraryFilter {
  type?: ItemType | null;
  topicId?: string | null;
  /** YYYY-MM-DD, inclusive, compared with created_at (UTC date). */
  from?: string | null;
  to?: string | null;
}

/** Live library items (not deleted, not dropped, not suggestions) matching the filter, newest first. */
export function filterLibrary(items: Item[], f: LibraryFilter): Item[] {
  return (
    items
      .filter((i) => !i.deleted_at && i.status !== 'dropped' && i.status !== 'suggested')
      // List entries live on the Lists screen unless asked for explicitly.
      .filter((i) => (f.type ? i.type === f.type : i.type !== 'list_entry'))
      .filter((i) => !f.topicId || i.topic_ids.includes(f.topicId))
      .filter((i) => !f.from || i.created_at.slice(0, 10) >= f.from)
      .filter((i) => !f.to || i.created_at.slice(0, 10) <= f.to)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  );
}

/** Items in the Trash (deleted within TRASH_DAYS), most recently deleted first. */
export function trashItems(items: Item[], now = new Date()): Item[] {
  const cutoff = now.getTime() - TRASH_DAYS * 86_400_000;
  return items
    .filter((i) => i.deleted_at && Date.parse(i.deleted_at) > cutoff)
    .sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));
}

/**
 * Settles an unsure (suggested) item from AI sorting with one tap: keep its
 * type, or pick another (recorded as a correction). When the capture has no
 * unsure items left, it counts as sorted.
 */
export async function resolveSuggestion(
  db: AirheadDb,
  userId: string,
  itemId: string,
  type: ItemType,
): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) return;
  // One write: never a re-typed item that still reads as unsure.
  await changeItemType(db, userId, itemId, type, { status: 'open' });
  if (!item.capture_id) return;
  const stillUnsure = await db.items
    .where('capture_id')
    .equals(item.capture_id)
    .filter((i) => i.status === 'suggested' && !i.deleted_at)
    .count();
  const capture = await db.captures.get(item.capture_id);
  if (stillUnsure === 0 && capture?.status === 'needs_review') {
    await update(db, 'captures', capture.id, {
      status: 'sorted',
      sorted_at: new Date().toISOString(),
    });
  }
}

/** Unsure items waiting for a tap in the Inbox (date suggestions live on Today). */
export const isInboxSuggestion = (i: Item) =>
  i.status === 'suggested' && !i.deleted_at && i.type !== 'event';
