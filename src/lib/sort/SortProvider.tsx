import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/context';
import type { SortOutcome } from '../auth/types';
import { useDb } from '../db/context';
import { useSync } from '../sync/context';
import { SortContext, type SortApi } from './context';

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
export function SortProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const { services } = useAuth();
  const sync = useSync();
  const sorting = services.sorting;
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<SortOutcome | null>(null);
  const inFlight = useRef(false);
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  const sortNow = useCallback(async () => {
    if (!sorting || inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    try {
      await syncRef.current.syncNow();
      const outcome = navigator.onLine === false ? OFFLINE : await sorting.sortNow();
      setLast(outcome);
      if (outcome.ok) await syncRef.current.syncNow();
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }, [sorting]);

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
