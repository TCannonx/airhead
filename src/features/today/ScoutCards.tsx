import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { acceptCard, dismissCard } from '../../lib/scout/cards';
import { useOnline } from '../../lib/useOnline';
import { deviceTimeZone } from '../calendar/useCalendarData';
import { Button } from '../../ui/Button';
import { GroupedList, GroupedListItem, Section } from '../../ui/GroupedList';

/**
 * Scout's ideas (Task 8.12), on Today and Insights: each card waits for
 * Accept (creates the proposed task or event) or Dismiss. "Scout now" runs
 * Scout on demand (online, one AI call at most).
 */
export default function ScoutCards() {
  const db = useDb();
  const { services, user } = useAuth();
  const online = useOnline();
  const cards = useLiveQuery(
    async () =>
      (await db.suggestions.where('status').equals('open').toArray())
        .filter((s) => !s.deleted_at)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [db],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scout = services.scout;
  const userId = user?.id ?? '';

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!cards || (cards.length === 0 && !scout)) return null;
  return (
    <Section
      title="Ideas"
      label="Ideas from Scout"
      action={
        scout && (
          <Button
            size="sm"
            variant="plain"
            className="-mr-3"
            loading={busy}
            disabled={!online}
            title={
              online
                ? 'At most one AI call with up to 3 web searches (≈ €0.04)'
                : 'Needs a connection'
            }
            onClick={() => void act(async () => setMessage((await scout.run()).message))}
          >
            {busy ? 'Scouting…' : 'Scout now'}
          </Button>
        )
      }
      footer={message ? <p role="status">{message}</p> : undefined}
    >
      <GroupedList>
        {cards.length === 0 && (
          <GroupedListItem>
            <p className="text-body text-fg-muted">No ideas waiting.</p>
          </GroupedListItem>
        )}
        {cards.slice(0, 5).map((s) => (
          <GroupedListItem key={s.id}>
            <p className="text-body font-medium break-words">{s.title}</p>
            {s.body && <p className="text-footnote text-fg-muted">{s.body}</p>}
            {s.source_url && (
              <a
                href={s.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-footnote text-accent underline"
              >
                Source
              </a>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {s.proposed && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => void act(() => acceptCard(db, userId, s, deviceTimeZone()))}
                >
                  Accept {s.title}
                </Button>
              )}
              <Button
                size="sm"
                variant="plain"
                disabled={busy}
                onClick={() => void act(() => dismissCard(db, userId, s))}
              >
                Dismiss {s.title}
              </Button>
            </div>
          </GroupedListItem>
        ))}
      </GroupedList>
    </Section>
  );
}
