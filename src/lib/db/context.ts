import { createContext, useContext } from 'react';
import type { AirheadDb } from './db';

export const DbContext = createContext<AirheadDb | null>(null);

/** The signed-in user's local database (the UI reads only from here). */
export function useDb(): AirheadDb {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used inside <DataProvider>');
  return db;
}
