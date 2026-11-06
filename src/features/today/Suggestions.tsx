import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../../lib/db/context';
import { acceptSuggestion, dismissSuggestion, eventLabel } from '../../lib/db/events';

/** One-tap cards for dates the free rules weren't sure about. */
export default function Suggestions() {
  const db = useDb();
  const suggestions = useLiveQuery(
    () =>
      db.items
        .where('[type+status]')
        .equals(['event', 'suggested'])
        .filter((i) => !i.deleted_at)
        .sortBy('start_at'),
    [db],
  );
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Suggestions
      </h2>
      <ul aria-label="Suggestions" className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
          >
            <p className="font-medium">{s.title}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {eventLabel(s)} · not sure about the date or time
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                onClick={() => void acceptSuggestion(db, s.id)}
              >
                Add to calendar
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => void dismissSuggestion(db, s.id)}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
