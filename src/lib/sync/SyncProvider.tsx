import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/context';
import { useDb } from '../db/context';
import { SyncContext, type SyncApi } from './context';
import { SyncEngine } from './engine';
import type { SyncStatus } from './types';

/** Starts the sync engine for the signed-in user (no-op in local mode). */
export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const { services } = useAuth();
  const engine = useMemo(
    () => (services.remote ? new SyncEngine(db, services.remote) : null),
    [db, services.remote],
  );
  const [status, setStatus] = useState<SyncStatus | null>(() => engine?.getStatus() ?? null);

  useEffect(() => {
    if (!engine) return;
    const unsubscribe = engine.subscribe(setStatus);
    const stop = engine.start();
    return () => {
      stop();
      unsubscribe();
    };
  }, [engine]);

  const value = useMemo<SyncApi>(
    () => ({ status, syncNow: () => engine?.syncNow() ?? Promise.resolve() }),
    [status, engine],
  );
  return <SyncContext value={value}>{children}</SyncContext>;
}
