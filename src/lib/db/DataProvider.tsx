import { useEffect, useMemo, type ReactNode } from 'react';
import { currentDevice } from '../device';
import { DbContext } from './context';
import { openUserDb } from './db';
import { registerDevice } from './devices';
import { requestPersistentStorage } from './repository';

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const db = useMemo(() => openUserDb(userId), [userId]);

  useEffect(() => {
    // Both are best-effort; ignore anything cut short by close (e.g. sign-out).
    requestPersistentStorage(db).catch(() => {});
    registerDevice(db, userId, currentDevice()).catch(() => {});
    // StrictMode runs effects twice: allow the same instance to reopen on next use.
    return () => db.close({ disableAutoOpen: false });
  }, [db, userId]);

  return <DbContext value={db}>{children}</DbContext>;
}
