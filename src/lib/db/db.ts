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

/** A file kept on the device (and uploaded to Storage when online). Not a synced table. */
export interface FileRecord {
  id: string;
  user_id: string;
  capture_id: string;
  /** Storage path: <user_id>/<capture_id>/<id>.<ext> */
  path: string;
  mime: string;
  size: number;
  /** Bytes, not a Blob: Blob storage in IndexedDB has been unreliable on older Safari. */
  data: ArrayBuffer;
  uploaded: boolean;
  created_at: string;
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
  files: EntityTable<FileRecord, 'id'>;
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
  // v2: files kept on the device and queued for upload (booleans can't be indexed).
  db.version(2).stores({ files: 'id, capture_id' });
  // v3: memory (Task 3.9).
  db.version(3).stores({
    memory_facts: 'id, status, server_updated_at',
    learned_rules: 'id, pattern, server_updated_at',
  });
  // v4: calendar, work and leave, sharing (Task 4.1). external_events is pull-only.
  db.version(4).stores({
    series: 'id, server_updated_at',
    feeds: 'id, kind, server_updated_at',
    external_events: 'id, feed_id, start_at, server_updated_at',
    work_days: 'id, date, server_updated_at',
    leave_bookings: 'id, start_date, end_date, server_updated_at',
  });
  // v5: morning briefs (Task 5.1), pull-only.
  db.version(5).stores({ briefs: 'id, local_date, server_updated_at' });
  // v6: note documents (Task 6.1).
  db.version(6).stores({ note_docs: 'id, kind, server_updated_at' });
  // v7: Workshop drafts and sessions (Task 7.5).
  db.version(7).stores({
    drafts: 'id, item_id, server_updated_at',
    workshop_sessions: 'id, server_updated_at',
  });
  // v8: weekly reviews (Task 8.4), pull-only.
  db.version(8).stores({ reviews: 'id, week_start, server_updated_at' });
  // v9: Scout runs (pull-only) and suggestion cards (Task 8.9).
  db.version(9).stores({
    scout_runs: 'id, created_at, server_updated_at',
    suggestions: 'id, status, server_updated_at',
  });
  return db;
}
