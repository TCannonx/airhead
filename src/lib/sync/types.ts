import type { SyncTable } from '../schemas/records';

export type RemoteRow = Record<string, unknown> & { id: string };

/** Keyset position for paging pulls: strictly after (ts, id). */
export interface PullKey {
  ts: string;
  id: string;
}

/** What the sync engine needs from the server (Supabase in the app, a fake in tests). */
export interface Remote {
  /** Inserts or updates rows by id. The server stamps server_updated_at. */
  upsert(table: SyncTable, rows: RemoteRow[]): Promise<void>;
  /** Rows ordered by (server_updated_at, id), strictly after `after`. */
  pullPage(table: SyncTable, after: PullKey | null, limit: number): Promise<RemoteRow[]>;
  /** Calls back when another device changed something (Realtime). */
  subscribe?(onChange: () => void): () => void;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Rows with changes not yet on the server. */
  pending: number;
  lastSyncedAt: string | null;
  message: string | null;
}
