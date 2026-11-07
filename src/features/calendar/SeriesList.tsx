import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useDb } from '../../lib/db/context';
import { LINKED_COLOURS } from '../../lib/db/feeds';
import { deleteSeries, recolourSeries } from '../../lib/db/series';

const small =
  'rounded-md px-2 py-1 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';

/** Imported series: recolour or delete a whole schedule at once. */
export default function SeriesList() {
  const db = useDb();
  const [confirming, setConfirming] = useState<string | null>(null);
  const rows = useLiveQuery(async () => {
    const series = (await db.series.toArray()).filter((s) => !s.deleted_at);
    const items = await db.items.where('type').equals('event').toArray();
    return series
      .map((s) => ({
        series: s,
        count: items.filter((i) => i.series_id === s.id && !i.deleted_at).length,
      }))
      .sort((a, b) => b.series.created_at.localeCompare(a.series.created_at));
  }, [db]);
  if (!rows || rows.length === 0) return null;

  return (
    <section className="mt-8 max-w-2xl">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Imported schedules
      </h2>
      <ul
        aria-label="Imported schedules"
        className="divide-y divide-slate-100 dark:divide-slate-800"
      >
        {rows.map(({ series, count }) => (
          <li key={series.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm">
              <span className="font-medium">{series.name}</span>{' '}
              <span className="text-slate-500">
                · {count} event{count === 1 ? '' : 's'} ·{' '}
                {series.calendar === 'us' ? 'Us' : 'Personal'}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <label className="sr-only" htmlFor={`colour-${series.id}`}>
                Colour for {series.name}
              </label>
              <select
                id={`colour-${series.id}`}
                className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                value={series.colour ?? ''}
                onChange={(e) => void recolourSeries(db, series.id, e.target.value || null)}
              >
                <option value="">Calendar colour</option>
                {LINKED_COLOURS.map((c, i) => (
                  <option key={c} value={c}>
                    Colour {i + 1}
                  </option>
                ))}
              </select>
              {series.colour && (
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ background: series.colour }}
                />
              )}
              {confirming === series.id ? (
                <>
                  <button
                    type="button"
                    className={`${small} text-red-600`}
                    onClick={() => void deleteSeries(db, series.id).then(() => setConfirming(null))}
                  >
                    Delete {count} event{count === 1 ? '' : 's'}
                  </button>
                  <button type="button" className={small} onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete ${series.name}`}
                  className={`${small} text-red-600`}
                  onClick={() => setConfirming(series.id)}
                >
                  Delete
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-500">Deleted events stay in the Trash for 30 days.</p>
    </section>
  );
}
