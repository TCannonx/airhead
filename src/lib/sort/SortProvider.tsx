import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/context';
import type { SortOutcome } from '../auth/types';
import { useDb } from '../db/context';
import { useSync } from '../sync/context';
import { SortContext, type SortApi } from './context';

/** A sync that takes longer than this no longer holds sorting up. */
export const SYNC_WAIT_MS = 15_000;
/** An attempt older than this no longer blocks a new tap. */
const STALE_MS = 60_000;

/** Resolves when `p` settles or after `ms`, whichever is first; never rejects. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

const OFFLINE: SortOutcome = {
  ok: false,
  error_code: 'offline',
  message: 'You are offline. Captures will be sorted when you are back online.',
};

/**
 * AI sorting triggers on the device: once when the app opens (if anything is
 * waiting) and on demand ("Sort now"). Each run syncs first, so captures made
 * offline reach the server, then sorts, then syncs the results back.
 * (The server also sorts on its own schedule; see dispatch_sort_batches.)
 */
export function SortProvider({
  children,
  syncWaitMs = SYNC_WAIT_MS,
}: {
  children: ReactNode;
  /** Tests shorten the wait. */
  syncWaitMs?: number;
}) {
  const db = useDb();
  const { services } = useAuth();
  const sync = useSync();
  const sorting = services.sorting;
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<SortOutcome | null>(null);
  /** When the current attempt started (null: none running). */
  const inFlight = useRef<number | null>(null);
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  const sortNow = useCallback(async () => {
    if (!sorting) return;
    const started = Date.now();
    if (inFlight.current !== null && started - inFlight.current < STALE_MS) return;
    inFlight.current = started;
    setRunning(true);
    setLast(null);
    try {
      // Send captures made on this device first, but never wait on sync forever:
      // the server sorts whatever it already has.
      await settleWithin(syncRef.current.syncNow(), syncWaitMs);
      const outcome = navigator.onLine === false ? OFFLINE : await sorting.sortNow();
      setLast(outcome);
      if (outcome.ok) void syncRef.current.syncNow();
    } catch {
      setLast({
        ok: false,
        error_code: 'client_error',
        message: 'Sorting could not start on this device. It will run automatically later.',
      });
    } finally {
      if (inFlight.current === started) inFlight.current = null;
      setRunning(false);
    }
  }, [sorting, syncWaitMs]);

  // App open: sort once if anything is waiting.
  const triedOnOpen = useRef(false);
  useEffect(() => {
    if (!sorting || triedOnOpen.current) return;
    triedOnOpen.current = true;
    void (async () => {
      const waiting = await db.captures
        .where('status')
        .equals('unsorted')
        .filter((c) => !c.deleted_at)
        .count()
        .catch(() => 0);
      if (waiting > 0) await sortNow();
    })();
  }, [db, sorting, sortNow]);

  const value = useMemo<SortApi>(
    () => ({ available: !!sorting, running, last, sortNow }),
    [sorting, running, last, sortNow],
  );
  return <SortContext value={value}>{children}</SortContext>;
}
