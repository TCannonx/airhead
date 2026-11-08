import type { AirheadDb, OutboxEntry } from '../db/db';
import { uploadPending } from '../files/upload';
import { schemas, SYNC_TABLES, type NoteDoc, type SyncTable } from '../schemas/records';
import type { PullKey, Remote, RemoteRow, SyncStatus } from './types';

export const PUSH_BATCH = 100;
export const PULL_PAGE = 500;
/**
 * Each pull starts this far before the cursor. server_updated_at is the
 * transaction start time, so a slow transaction can commit after a pull with
 * a timestamp just before the cursor; re-reading a minute of rows catches it.
 * Re-applying a row is harmless.
 */
export const PULL_OVERLAP_MS = 60_000;
const MIN_ID = '00000000-0000-0000-0000-000000000000';

/** Sends every queued change to the server. Throws on network failure (queue is kept). */
export async function push(db: AirheadDb, remote: Remote): Promise<void> {
  const entries = await db.outbox.orderBy('seq').toArray();
  if (entries.length === 0) return;

  const byTable = new Map<SyncTable, Map<string, number>>();
  for (const e of entries) {
    let ids = byTable.get(e.table);
    if (!ids) byTable.set(e.table, (ids = new Map()));
    ids.set(e.row_id, Math.max(ids.get(e.row_id) ?? 0, e.seq ?? 0));
  }

  for (const table of SYNC_TABLES) {
    const ids = byTable.get(table);
    if (!ids) continue;
    const idList = [...ids.keys()];
    for (let i = 0; i < idList.length; i += PUSH_BATCH) {
      const batchIds = idList.slice(i, i + PUSH_BATCH);
      const rows = (await db.table(table).bulkGet(batchIds)).filter(
        (r): r is RemoteRow => r !== undefined,
      );
      if (rows.length > 0) await remote.upsert(table, rows);
      // Remove only the entries that were sent; anything queued meanwhile stays.
      await db.transaction('rw', db.outbox, async () => {
        for (const id of batchIds) {
          const maxSeq = ids.get(id) ?? 0;
          await db.outbox
            .where('row_id')
            .equals(id)
            .filter((e: OutboxEntry) => e.table === table && (e.seq ?? 0) <= maxSeq)
            .delete();
        }
      });
    }
  }
}

/** Fetches everything changed on the server since the last pull, table by table. */
export async function pull(db: AirheadDb, remote: Remote): Promise<void> {
  for (const table of SYNC_TABLES) {
    const state = await db.sync_state.get(table);
    let cursor = state?.cursor ?? null;
    let after: PullKey | null = cursor
      ? { ts: new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString(), id: MIN_ID }
      : null;

    for (;;) {
      const page = await remote.pullPage(table, after, PULL_PAGE);
      if (page.length === 0) break;
      await applyPage(db, table, page);
      const last = page[page.length - 1] as RemoteRow;
      after = { ts: String(last.server_updated_at), id: last.id };
      if (!cursor || Date.parse(after.ts) > Date.parse(cursor)) cursor = after.ts;
      if (page.length < PULL_PAGE) break;
    }

    await db.sync_state.put({ table, cursor, cursor_ids: [] });
  }
}

async function applyPage(db: AirheadDb, table: SyncTable, page: RemoteRow[]) {
  const schema = schemas[table];
  const tables =
    table === 'note_docs' ? [db.note_docs, db.items, db.outbox] : [db.table(table), db.outbox];
  await db.transaction('rw', tables, async () => {
    for (const raw of page) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) continue; // never let one odd row block sync
      // A row with unpushed local edits is newer than the server's copy:
      // keep it; the next push makes it the server's version.
      const pending = await db.outbox.where('row_id').equals(raw.id).count();
      if (pending > 0) {
        if (table === 'note_docs') await keepBothNoteVersions(db, parsed.data as NoteDoc);
        continue;
      }
      await db.table(table).put(parsed.data);
    }
  });
}

/**
 * A note document changed on the server while this device has unsent edits
 * (Task 6.2). If another device wrote it after the version this edit started
 * from, both versions are kept: the local text becomes a "conflicted copy"
 * note and the server's version is applied. Writing is never thrown away.
 * Otherwise (this device's own earlier push coming back) the local edit stays
 * and simply learns the newer version number.
 */
async function keepBothNoteVersions(db: AirheadDb, remote: NoteDoc) {
  const local = await db.note_docs.get(remote.id);
  if (!local) return;
  const ownEcho = remote.writer_device !== null && remote.writer_device === local.writer_device;
  if (ownEcho || remote.version <= local.base_version) {
    if (remote.version > local.version) {
      await db.note_docs.put({
        ...local,
        version: remote.version,
        base_version: ownEcho ? remote.version : local.base_version,
      });
    }
    return;
  }

  const now = new Date();
  const copyId = crypto.randomUUID();
  const item = await db.items.get(local.id);
  const time = now.toLocaleString('en-IE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (item) {
    await db.items.put({
      ...item,
      id: copyId,
      title: `${item.title} (conflicted copy, ${time})`,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      server_updated_at: null,
      deleted_at: null,
    });
    await db.outbox.add({ table: 'items', row_id: copyId, queued_at: now.toISOString() });
  }
  await db.note_docs.put({
    ...local,
    id: copyId,
    version: 0,
    base_version: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    server_updated_at: null,
  });
  await db.outbox.add({ table: 'note_docs', row_id: copyId, queued_at: now.toISOString() });
  // The original note now shows the other device's version.
  await db.outbox
    .where('row_id')
    .equals(local.id)
    .filter((e: OutboxEntry) => e.table === 'note_docs')
    .delete();
  await db.note_docs.put(remote);
}

async function countPending(db: AirheadDb): Promise<number> {
  const keys = await db.outbox.orderBy('row_id').uniqueKeys();
  return keys.length;
}

export interface SyncEngineOptions {
  online?: () => boolean;
  /** Delay after a local write before syncing (batches fast typing). */
  writeDebounceMs?: number;
  intervalMs?: number;
}

const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

/**
 * Runs push + pull on the triggers from the plan: start (app open), the
 * browser coming back online, every minute while visible, after local writes
 * and when Realtime says another device changed something. One run at a time;
 * requests during a run fold into one follow-up run.
 */
export class SyncEngine {
  private status: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null, message: null };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly online: () => boolean;
  private readonly writeDebounceMs: number;
  private readonly intervalMs: number;

  private readonly db: AirheadDb;
  private readonly remote: Remote;

  constructor(db: AirheadDb, remote: Remote, options: SyncEngineOptions = {}) {
    this.db = db;
    this.remote = remote;
    this.online = options.online ?? (() => navigator.onLine);
    this.writeDebounceMs = options.writeDebounceMs ?? 1_000;
    this.intervalMs = options.intervalMs ?? 60_000;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: Partial<SyncStatus>) {
    this.status = { ...this.status, ...next };
    this.listeners.forEach((l) => l(this.status));
  }

  /** Re-reads the pending count (e.g. after a local write) without syncing. */
  async refreshPending(): Promise<void> {
    this.set({ pending: await countPending(this.db) });
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.status.lastSyncedAt) {
      const saved = await this.db.meta.get('lastSyncedAt');
      if (typeof saved?.value === 'string') this.set({ lastSyncedAt: saved.value });
    }
    this.set({ state: 'syncing', pending: await countPending(this.db), message: null });
    try {
      await push(this.db, this.remote);
      await uploadPending(this.db, this.remote);
      await pull(this.db, this.remote);
      const at = new Date().toISOString();
      await this.db.meta.put({ key: 'lastSyncedAt', value: at });
      this.failures = 0;
      this.set({
        state: 'idle',
        lastSyncedAt: at,
        pending: await countPending(this.db),
        detail: undefined,
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
      const pending = await countPending(this.db);
      if (!this.online()) {
        this.set({
          state: 'offline',
          pending,
          message: 'Offline. Changes are saved on this device.',
        });
      } else {
        const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 300_000;
        this.failures += 1;
        this.set({
          state: 'error',
          pending,
          message: `Couldn't reach the server. Will retry in ${Math.round(delay / 1000)} s.`,
          detail,
        });
        this.retryTimer = setTimeout(() => void this.syncNow(), delay);
      }
    }
  }

  /** Wires up the triggers. Returns a function that removes them. */
  start(): () => void {
    const onOnline = () => void this.syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.syncNow();
    };
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void this.syncNow();
    }, this.intervalMs);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onWrite = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void this.syncNow();
      }, this.writeDebounceMs);
      // Count refresh happens after the writing transaction commits.
      setTimeout(() => void this.refreshPending(), 0);
    };
    this.db.outbox.hook('creating', onWrite);
    const unsubscribeRemote = this.remote.subscribe?.(() => void this.syncNow());

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    void this.syncNow();

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.db.outbox.hook('creating').unsubscribe(onWrite);
      unsubscribeRemote?.();
    };
  }
}
