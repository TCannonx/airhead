import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { applyBadge, badgeCount } from '../lib/badge';
import { useDb } from '../lib/db/context';

/** Keeps the installed app's badge at overdue tasks plus open questions (Task 15.5). */
export function useAppBadge() {
  const db = useDb();
  const count = useLiveQuery(() => badgeCount(db), [db]);
  useEffect(() => {
    if (count !== undefined) void applyBadge(count);
  }, [count]);
}
