import type { SyncTable } from '../schemas/records';
import type { PullKey, Remote, RemoteRow } from './types';

/**
 * In-memory stand-in for Supabase used by tests: stamps server_updated_at
 * from its own clock (like the Postgres trigger), orders pulls by
 * (server_updated_at, id) and can be switched offline.
 */
export function createFakeRemote(startMs = Date.parse('2026-11-06T09:00:00Z')) {
  const tables = new Map<SyncTable, Map<string, RemoteRow>>();
  const listeners = new Set<() => void>();
  let clock = startMs;
  const state = { online: true, upsertCalls: [] as { table: SyncTable; ids: string[] }[] };
  const files = new Map<string, Blob>();
  let beforeUpsert: (() => Promise<void>) | null = null;

  const tableOf = (t: SyncTable) => {
    let m = tables.get(t);
    if (!m) tables.set(t, (m = new Map()));
    return m;
  };
  const fail = () => {
    if (!state.online) throw new TypeError('Failed to fetch');
  };

  const remote: Remote & {
    state: typeof state;
    files: Map<string, Blob>;
    rows(table: SyncTable): RemoteRow[];
    /** Writes a row as if another device/transaction did, at an explicit server time. */
    serverWrite(table: SyncTable, row: RemoteRow, atMs?: number): void;
    onBeforeUpsert(fn: (() => Promise<void>) | null): void;
    emitChange(): void;
    tick(ms: number): void;
  } = {
    state,
    files,
    async uploadFile(path, blob) {
      fail();
      files.set(path, blob);
    },
    async upsert(table, rows) {
      fail();
      if (beforeUpsert) await beforeUpsert();
      state.upsertCalls.push({ table, ids: rows.map((r) => String(r.id)) });
      for (const row of rows) {
        clock += 1;
        const existing = tableOf(table).get(String(row.id));
        let next: RemoteRow = row;
        // Like the database triggers (0018, 0019): an older edit from another
        // device becomes a conflicted copy, and every write gets the next version.
        if (
          table === 'note_docs' &&
          existing &&
          existing.writer_device !== row.writer_device &&
          Number(row.base_version) < Number(existing.version) &&
          JSON.stringify(row.doc) !== JSON.stringify(existing.doc)
        ) {
          const copyId = crypto.randomUUID();
          const item = tableOf('items').get(String(row.id));
          tableOf('items').set(copyId, {
            ...(item ?? { user_id: row.user_id, type: 'note', data: {} }),
            id: copyId,
            title: `${String(item?.title ?? 'Note')} (conflicted copy)`,
            server_updated_at: new Date(clock).toISOString(),
          } as RemoteRow);
          tableOf('note_docs').set(copyId, {
            ...row,
            id: copyId,
            version: 1,
            base_version: 0,
            server_updated_at: new Date(clock).toISOString(),
          });
          next = existing;
        }
        tableOf(table).set(String(row.id), {
          ...next,
          server_updated_at: new Date(clock).toISOString(),
          ...(table === 'note_docs' ? { version: Number(existing?.version ?? 0) + 1 } : {}),
          // Like 0021: drafts are numbered per item by the server, once.
          ...(table === 'drafts'
            ? {
                version: existing
                  ? existing.version
                  : 1 +
                    Math.max(
                      0,
                      ...[...tableOf('drafts').values()]
                        .filter((d) => d.item_id === row.item_id)
                        .map((d) => Number(d.version)),
                    ),
              }
            : {}),
        });
      }
    },
    async pullPage(table, after: PullKey | null, limit) {
      fail();
      return [...tableOf(table).values()]
        .filter((r) => {
          if (!after) return true;
          const ts = String(r.server_updated_at);
          return ts > after.ts || (ts === after.ts && String(r.id) > after.id);
        })
        .sort((a, b) =>
          String(a.server_updated_at) === String(b.server_updated_at)
            ? String(a.id).localeCompare(String(b.id))
            : String(a.server_updated_at).localeCompare(String(b.server_updated_at)),
        )
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    rows: (table) => [...tableOf(table).values()],
    serverWrite(table, row, atMs) {
      clock = Math.max(clock, atMs ?? clock + 1);
      tableOf(table).set(String(row.id), {
        ...row,
        server_updated_at: new Date(atMs ?? clock).toISOString(),
      });
    },
    onBeforeUpsert(fn) {
      beforeUpsert = fn;
    },
    emitChange() {
      listeners.forEach((l) => l());
    },
    tick(ms) {
      clock += ms;
    },
  };
  return remote;
}
