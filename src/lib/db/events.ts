import { TZDate } from '@date-fns/tz';
import { differenceInCalendarDays, format } from 'date-fns';
import { DEFAULT_TIME_ZONE } from '../rules';
import type { Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { softDelete, update } from './repository';

const sortedNow = () => ({ status: 'sorted' as const, sorted_at: new Date().toISOString() });

/** "Sat 11:00" within the next week; "Sun 20 Dec, 20:00" beyond; all-day without a time. */
export function eventLabel(
  item: Pick<Item, 'start_at' | 'all_day'>,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (!item.start_at) return '';
  const when = new TZDate(item.start_at, timeZone);
  const days = differenceInCalendarDays(when, new TZDate(now, timeZone));
  const day = days >= 0 && days < 7 ? format(when, 'EEE') : format(when, 'EEE d MMM');
  if (item.all_day) return day;
  return days >= 0 && days < 7
    ? `${day} ${format(when, 'HH:mm')}`
    : `${day}, ${format(when, 'HH:mm')}`;
}

/** Undo an event the free rules added: soft delete it, send the capture back to sorting. */
/** "–23:00" after a timed event's start when it has an end (else empty). */
export function endLabel(
  item: Pick<Item, 'end_at' | 'all_day'>,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  if (item.all_day || !item.end_at) return '';
  return `–${format(new TZDate(item.end_at, timeZone), 'HH:mm')}`;
}

export async function undoInstantEvent(db: AirheadDb, itemId: string): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) return;
  await softDelete(db, 'items', itemId);
  if (item.capture_id) {
    // Sorting then treats the note afresh (no instant event left to tidy).
    const capture = await db.captures.get(item.capture_id);
    const { instant_item_id: _gone, ...payload } = capture?.payload ?? {};
    await update(db, 'captures', item.capture_id, { status: 'unsorted', sorted_at: null, payload });
  }
}

export async function acceptSuggestion(db: AirheadDb, itemId: string): Promise<void> {
  const item = await update(db, 'items', itemId, { status: 'open', calendar: 'personal' });
  if (item?.capture_id) await update(db, 'captures', item.capture_id, sortedNow());
}

export async function dismissSuggestion(db: AirheadDb, itemId: string): Promise<void> {
  const item = await update(db, 'items', itemId, { status: 'dropped' });
  if (item?.capture_id) await update(db, 'captures', item.capture_id, sortedNow());
}
