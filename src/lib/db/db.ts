import { Dexie, type EntityTable } from 'dexie';
import type { RowTypes, SyncTable } from '../schemas/records';

/** One pending change: push reads the row's current state, so repeats coalesce. */
export interface OutboxEntry {
  seq?: number;
  table: SyncTable;
  row_id: string;
  queued_at: string;
}

/** Per-table pull cursor: the highest server_updated_at already applied. */
export interface SyncState {
  table: SyncTable;
  cursor: string | null;
  /** Ids already applied at exactly `cursor` (rows can share a timestamp). */
  cursor_ids: string[];
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export type AirheadDb = Dexie & {
  [T in SyncTable]: EntityTable<RowTypes[T], 'id'>;
} & {
  outbox: EntityTable<OutboxEntry, 'seq'>;
  sync_state: EntityTable<SyncState, 'table'>;
  meta: EntityTable<MetaEntry, 'key'>;
};

/**
 * The device's full copy of the user's data. The UI reads only from here.
 * One database per signed-in user, so two accounts on one device never mix.
 */
export function openUserDb(userId: string): AirheadDb {
  const db = new Dexie(`airhead-${userId}`) as AirheadDb;
  db.version(1).stores({
    settings: 'id, server_updated_at',
    devices: 'id, server_updated_at',
    captures: 'id, status, captured_at, server_updated_at, deleted_at',
    items:
      'id, type, status, capture_id, list_id, start_at, due_at, server_updated_at, deleted_at, [type+status]',
    lists: 'id, sort_order, server_updated_at',
    topics: 'id, name, server_updated_at',
    corrections: 'id, capture_id, server_updated_at',
    outbox: '++seq, table, row_id',
    sync_state: 'table',
    meta: 'key',
  });
  return db;
}
