import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../../lib/db/context';
import { isInboxSuggestion } from '../../lib/db/sorting';

/** Captures still waiting for sorting (needs_review ones show as suggestions instead). */
export const INBOX_WAITING = new Set(['unsorted', 'failed']);

/**
 * What the Inbox tab badge counts: captures waiting to be sorted, unsure items
 * waiting for a tap and memory facts waiting for approval. 0 while loading.
 */
export function useInboxCount(): number {
  const db = useDb();
  return (
    useLiveQuery(async () => {
      const [captures, suggestions, facts] = await Promise.all([
        db.captures.filter((c) => !c.deleted_at && INBOX_WAITING.has(c.status)).count(),
        db.items.filter(isInboxSuggestion).count(),
        db.memory_facts.filter((f) => f.status === 'pending_approval' && !f.deleted_at).count(),
      ]);
      return captures + suggestions + facts;
    }, [db]) ?? 0
  );
}
