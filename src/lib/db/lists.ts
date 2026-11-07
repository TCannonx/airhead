import type { Item, List } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, newItem, save, softDelete, update } from './repository';

export const DEFAULT_LIST_NAME = 'Shopping';

/**
 * The default Shopping list's id is derived from the user id, so two devices
 * creating it offline write the same row instead of two lists.
 */
export const defaultListId = (userId: string) => `5b0f0000-${userId.slice(9)}`;

const norm = (s: string) => s.trim().toLowerCase();
const live = (l: List) => !l.deleted_at;

export async function ensureDefaultList(db: AirheadDb, userId: string): Promise<List> {
  const id = defaultListId(userId);
  const existing = await db.lists.get(id);
  if (existing) return existing;
  return save(db, 'lists', { ...baseRecord(userId), id, name: DEFAULT_LIST_NAME, sort_order: 0 });
}

export async function createList(db: AirheadDb, userId: string, name: string): Promise<List> {
  const lists = (await db.lists.toArray()).filter(live);
  const last = Math.max(0, ...lists.map((l) => l.sort_order));
  return save(db, 'lists', { ...baseRecord(userId), name: name.trim(), sort_order: last + 1 });
}

export const renameList = (db: AirheadDb, listId: string, name: string) =>
  update(db, 'lists', listId, { name: name.trim() });

/** Moves a list one place up (-1) or down (+1), renumbering all lists 0..n. */
export async function moveList(db: AirheadDb, _userId: string, listId: string, by: -1 | 1) {
  const lists = (await db.lists.orderBy('sort_order').toArray()).filter(live);
  const from = lists.findIndex((l) => l.id === listId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= lists.length) return;
  const [moved] = lists.splice(from, 1);
  if (moved) lists.splice(to, 0, moved);
  for (const [i, l] of lists.entries()) {
    if (l.sort_order !== i) await update(db, 'lists', l.id, { sort_order: i });
  }
}

export const addEntry = (db: AirheadDb, userId: string, listId: string, title: string) =>
  save(db, 'items', newItem(userId, { type: 'list_entry', title: title.trim(), list_id: listId }));

export async function toggleEntry(db: AirheadDb, itemId: string) {
  const item = await db.items.get(itemId);
  if (!item) return;
  const done = item.status !== 'done';
  await update(db, 'items', itemId, {
    status: done ? 'done' : 'open',
    completed_at: done ? new Date().toISOString() : null,
  });
}

/** Ticked-off entries go to the Trash (recoverable for 30 days). */
export async function clearCompleted(db: AirheadDb, listId: string) {
  const done = await db.items
    .where('list_id')
    .equals(listId)
    .filter((i) => i.status === 'done' && !i.deleted_at)
    .toArray();
  for (const i of done) await softDelete(db, 'items', i.id);
}

/** Live entries of a list: open first, then done; oldest first within each. */
export function listEntries(items: Item[], listId: string): Item[] {
  return items
    .filter((i) => i.type === 'list_entry' && i.list_id === listId && !i.deleted_at)
    .filter((i) => i.status === 'open' || i.status === 'done')
    .sort((a, b) =>
      a.status === b.status
        ? a.created_at.localeCompare(b.created_at)
        : a.status === 'open'
          ? -1
          : 1,
    );
}

/**
 * "Create list 'Packing'?" from an unsure sorting result: creates the list (or
 * reuses one with that name) and files every waiting entry proposed for it.
 */
export async function createListFromSuggestion(
  db: AirheadDb,
  userId: string,
  itemId: string,
): Promise<List | undefined> {
  const item = await db.items.get(itemId);
  const name = typeof item?.data.proposed_list === 'string' ? item.data.proposed_list : null;
  if (!item || !name) return undefined;
  const lists = (await db.lists.toArray()).filter(live);
  const list =
    lists.find((l) => norm(l.name) === norm(name)) ?? (await createList(db, userId, name));

  const waiting = await db.items
    .filter(
      (i) =>
        i.type === 'list_entry' &&
        i.status === 'suggested' &&
        !i.deleted_at &&
        typeof i.data.proposed_list === 'string' &&
        norm(i.data.proposed_list) === norm(name),
    )
    .toArray();
  for (const entry of waiting) {
    const { proposed_list: _drop, ...data } = entry.data;
    await update(db, 'items', entry.id, { list_id: list.id, status: 'open', data });
    if (entry.capture_id) {
      const unsure = await db.items
        .where('capture_id')
        .equals(entry.capture_id)
        .filter((i) => i.status === 'suggested' && !i.deleted_at)
        .count();
      const capture = await db.captures.get(entry.capture_id);
      if (unsure === 0 && capture?.status === 'needs_review') {
        await update(db, 'captures', capture.id, {
          status: 'sorted',
          sorted_at: new Date().toISOString(),
        });
      }
    }
  }
  return list;
}
