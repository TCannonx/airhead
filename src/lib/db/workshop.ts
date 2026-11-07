import type { Draft, DraftContent, Item, WorkshopSession } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, save, update } from './repository';

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
