/**
 * A small sync diary for this device: when the engine started and stopped,
 * every run, the stage it reached, errors, abandoned runs. It lives in memory
 * and localStorage (never IndexedDB, which may be the very thing that is stuck)
 * and is sent to the server so sync problems on a phone can be diagnosed
 * without asking the owner what the screen says.
 */
export interface SyncLogEntry {
  /** ISO time. */
  t: string;
  /** What happened, e.g. "run start", "run ok", "run error", "abandon". */
  e: string;
  /** Detail: stage, error text, run id. */
  d?: string;
}

const KEY = 'airhead.syncLog';
const MAX = 200;
let entries: SyncLogEntry[] | null = null;
let unsent = 0;

function load(): SyncLogEntry[] {
  if (entries) return entries;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    entries = Array.isArray(parsed) ? (parsed as SyncLogEntry[]).slice(-MAX) : [];
  } catch {
    entries = [];
  }
  return entries;
}

function save(list: SyncLogEntry[]) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the in-memory log still works.
  }
}

/** Notes one sync event. Never throws. */
export function logSync(e: string, d?: string): void {
  const list = load();
  list.push(
    d ? { t: new Date().toISOString(), e, d: d.slice(0, 200) } : { t: new Date().toISOString(), e },
  );
  if (list.length > MAX) list.splice(0, list.length - MAX);
  unsent = Math.min(unsent + 1, MAX);
  save(list);
}

/** The newest entries, oldest first. */
export function readSyncLog(limit = MAX): SyncLogEntry[] {
  return load().slice(-limit);
}

/** Entries not yet sent to the server (oldest first), and a way to mark them sent. */
export function takeUnsent(): { entries: SyncLogEntry[]; markSent: () => void } {
  const count = unsent;
  const list = load().slice(-count);
  return {
    entries: count > 0 ? list : [],
    markSent: () => {
      unsent = Math.max(0, unsent - count);
    },
  };
}

/** Tests only. */
export function resetSyncLog(): void {
  entries = [];
  unsent = 0;
  save([]);
}
