import type { Capture, Draft, DraftContent, Item, WorkshopSession } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, newItem, save, update } from './repository';

/**
 * The Workshop (Task 7.5): an item is in it when `data.workshop` is true. Its
 * drafts are append-only versions (the server numbers them; the device's
 * number is a placeholder until the next pull), and one session per item
 * holds the conversation so far.
 */
export const inWorkshop = (i: Pick<Item, 'data' | 'deleted_at'>) =>
  !i.deleted_at && i.data.workshop === true;

export async function sendToWorkshop(db: AirheadDb, item: Item): Promise<void> {
  if (item.data.workshop === true) return;
  await update(db, 'items', item.id, { data: { ...item.data, workshop: true } });
}

/**
 * A short title for a Workshop note made from captured words (Task 11.2): the
 * first line, capitalised, at most 80 characters. Mirrors the planner's.
 */
export function workshopTitle(text: string): string {
  const line =
    text
      .trim()
      .split('\n')[0]
      ?.trim()
      .replace(/[.\s]+$/, '') ?? '';
  const short = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : 'Untitled';
}

/**
 * Send to Workshop on a capture (Task 11.2). If sorting already made a note or
 * idea from it, that item goes to the Workshop. Otherwise a note is made from
 * the capture's text, kept word for word in its body and linked by capture_id.
 * The capture is marked sorted with `payload.workshop_item_id`, so its chip
 * says "Sent to Workshop". A second tap changes nothing.
 */
export async function sendCaptureToWorkshop(
  db: AirheadDb,
  userId: string,
  captureId: string,
): Promise<Item | null> {
  const capture = await db.captures.get(captureId);
  if (!capture || capture.deleted_at) return null;
  const linked =
    typeof capture.payload.workshop_item_id === 'string'
      ? await db.items.get(capture.payload.workshop_item_id)
      : undefined;
  let item: Item | undefined = linked && !linked.deleted_at ? linked : undefined;
  if (!item) {
    const own = (await db.items.where('capture_id').equals(capture.id).toArray()).filter(
      (i) => !i.deleted_at,
    );
    item =
      own.find((i) => i.data.workshop === true) ??
      own.find((i) => i.type === 'note' || i.type === 'idea');
  }
  if (item) await sendToWorkshop(db, item);
  else {
    const text = capture.text ?? capture.url ?? '';
    item = await save(
      db,
      'items',
      newItem(userId, {
        type: 'note',
        title: workshopTitle(text || (capture.kind === 'image' ? 'Photo' : '')),
        body: text || null,
        capture_id: capture.id,
        data: { workshop: true, workshop_from: 'manual' },
      }),
    );
  }
  if (capture.payload.workshop_item_id !== item.id || capture.status !== 'sorted') {
    await update(db, 'captures', capture.id, {
      status: 'sorted',
      sorted_at: capture.sorted_at ?? new Date().toISOString(),
      payload: { ...capture.payload, workshop_item_id: item.id, workshop_reason: 'manual' },
    } as Partial<Capture>);
  }
  return (await db.items.get(item.id)) ?? item;
}

export async function leaveWorkshop(db: AirheadDb, item: Item): Promise<void> {
  const data = { ...item.data };
  delete data.workshop;
  await update(db, 'items', item.id, { data });
}

/** Newest first. */
export async function draftsFor(db: AirheadDb, itemId: string): Promise<Draft[]> {
  const all = await db.drafts.where('item_id').equals(itemId).toArray();
  return all
    .filter((d) => !d.deleted_at)
    .sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at));
}

export async function addDraft(
  db: AirheadDb,
  userId: string,
  itemId: string,
  content: DraftContent,
  source: Draft['source'],
): Promise<Draft> {
  const latest = (await draftsFor(db, itemId))[0];
  return save(db, 'drafts', {
    ...baseRecord(userId),
    item_id: itemId,
    version: (latest?.version ?? 0) + 1,
    content,
    source,
  });
}

export async function sessionFor(
  db: AirheadDb,
  itemId: string,
): Promise<WorkshopSession | undefined> {
  const s = await db.workshop_sessions.get(itemId);
  return s && !s.deleted_at ? s : undefined;
}
