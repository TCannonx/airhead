import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { AirheadDb } from '../db/db';
import { SearchIndex, type SearchResult } from './index';

const indexes = new WeakMap<AirheadDb, SearchIndex>();

/** Searches the on-device index for this user's database (kept up to date with live data). */
export function useSearch(db: AirheadDb, query: string): SearchResult[] | undefined {
  const index = useMemo(() => {
    let idx = indexes.get(db);
    if (!idx) indexes.set(db, (idx = new SearchIndex()));
    return idx;
  }, [db]);
  const data = useLiveQuery(
    async () => ({
      items: await db.items.toArray(),
      captures: await db.captures.toArray(),
      noteDocs: await db.note_docs.toArray(),
    }),
    [db],
  );
  return useMemo(() => {
    if (!data) return undefined;
    index.sync(data.items, data.captures, data.noteDocs);
    return index.search(query);
  }, [data, index, query]);
}
