import { useEffect, useMemo, type ReactNode } from 'react';
import { DbContext } from './context';
import { openUserDb } from './db';
import { requestPersistentStorage } from './repository';

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const db = useMemo(() => openUserDb(userId), [userId]);

  useEffect(() => {
    // Ignore a request cut short by close (e.g. sign-out mid-flight).
    requestPersistentStorage(db).catch(() => {});
    // StrictMode runs effects twice: allow the same instance to reopen on next use.
    return () => db.close({ disableAutoOpen: false });
  }, [db]);

  return <DbContext value={db}>{children}</DbContext>;
}
