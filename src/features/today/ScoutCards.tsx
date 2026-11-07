import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { acceptCard, dismissCard } from '../../lib/scout/cards';
import { useOnline } from '../../lib/useOnline';
import { deviceTimeZone } from '../calendar/useCalendarData';

const btn = 'rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50';

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
    <section aria-label="Ideas from Scout" className="mt-6 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Ideas</h2>
        {scout && (
          <button
            type="button"
            className={`${btn} bg-slate-100 hover:bg-slate-200 dark:bg-slate-800`}
            disabled={busy || !online}
            title={
              online
                ? 'At most one AI call with up to 3 web searches (≈ €0.04)'
                : 'Needs a connection'
            }
            onClick={() => void act(async () => setMessage((await scout.run()).message))}
          >
            {busy ? 'Scouting…' : 'Scout now'}
          </button>
        )}
      </div>
      {cards.length === 0 && <p className="text-sm text-slate-500">No ideas waiting.</p>}
      <ul className="space-y-2">
        {cards.slice(0, 5).map((s) => (
          <li
            key={s.id}
            className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800"
          >
            <p className="font-medium">{s.title}</p>
            {s.body && <p className="text-slate-600 dark:text-slate-400">{s.body}</p>}
            {s.source_url && (
              <a
                href={s.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-600 underline"
              >
                Source
              </a>
            )}
            <div className="mt-2 flex gap-2">
              {s.proposed && (
                <button
                  type="button"
                  className={`${btn} bg-indigo-600 text-white`}
                  disabled={busy}
                  onClick={() => void act(() => acceptCard(db, userId, s, deviceTimeZone()))}
                >
                  Accept {s.title}
                </button>
              )}
              <button
                type="button"
                className={`${btn} bg-slate-100 hover:bg-slate-200 dark:bg-slate-800`}
                disabled={busy}
                onClick={() => void act(() => dismissCard(db, userId, s))}
              >
                Dismiss {s.title}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="text-sm text-slate-600">
          {message}
        </p>
      )}
    </section>
  );
}
