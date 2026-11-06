import {
  schemas,
  type Capture,
  type Item,
  type RowTypes,
  type SyncTable,
} from '../schemas/records';
import type { AirheadDb } from './db';

const now = () => new Date().toISOString();

export function baseRecord(userId: string) {
  const t = now();
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    created_at: t,
    updated_at: t,
    server_updated_at: null,
    deleted_at: null,
  };
}

export function newCapture(userId: string, fields: Partial<Capture> = {}): Capture {
  const base = baseRecord(userId);
  return {
    ...base,
    kind: 'text',
    text: null,
    url: null,
    payload: {},
    source: 'app',
    status: 'unsorted',
    captured_at: base.created_at,
    sorted_at: null,
    ...fields,
  };
}

export function newItem(
  userId: string,
  fields: Partial<Item> & Pick<Item, 'type' | 'title'>,
): Item {
  return {
    ...baseRecord(userId),
    capture_id: null,
    body: null,
    data: {},
    status: 'open',
    due_at: null,
    start_at: null,
    end_at: null,
    all_day: false,
    rrule: null,
    calendar: null,
    series_id: null,
    list_id: null,
    topic_ids: [],
    confidence: null,
    top3_date: null,
    carry_count: 0,
    completed_at: null,
    ...fields,
  };
}

/**
 * The only way the app writes data: validates the row, stamps updated_at, and
 * stores it together with an outbox entry in one transaction. Never waits on
 * the network.
 */
export async function save<T extends SyncTable>(
  db: AirheadDb,
  table: T,
  row: RowTypes[T],
): Promise<RowTypes[T]> {
  const next = schemas[table].parse({ ...row, updated_at: now() }) as RowTypes[T];
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).put(next);
    await db.outbox.add({ table, row_id: next.id, queued_at: now() });
  });
  return next;
}

export async function update<T extends SyncTable>(
  db: AirheadDb,
  table: T,
  id: string,
  changes: Partial<RowTypes[T]>,
): Promise<RowTypes[T] | undefined> {
  const current = (await db.table(table).get(id)) as RowTypes[T] | undefined;
  if (!current) return undefined;
  return save(db, table, { ...current, ...changes });
}

/** Soft delete: the row stays (in Trash) for 30 days and syncs as a change. */
export function softDelete(db: AirheadDb, table: SyncTable, id: string) {
  return update(db, table, id, { deleted_at: now() });
}

export function restore(db: AirheadDb, table: SyncTable, id: string) {
  return update(db, table, id, { deleted_at: null });
}

type StorageLike = Pick<StorageManager, 'persist' | 'persisted'> | undefined;

/**
 * Asks the browser to keep this site's data under storage pressure (important
 * on iOS). Asked once; the answer is remembered in `meta`.
 */
export async function requestPersistentStorage(
  db: AirheadDb,
  storage: StorageLike = typeof navigator !== 'undefined' ? navigator.storage : undefined,
): Promise<boolean> {
  const remembered = await db.meta.get('persisted');
  if (typeof remembered?.value === 'boolean') return remembered.value;
  if (!storage?.persist) return false;
  let granted: boolean;
  try {
    granted = (await storage.persisted()) || (await storage.persist());
  } catch {
    granted = false;
  }
  await db.meta.put({ key: 'persisted', value: granted });
  return granted;
}
