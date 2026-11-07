import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useDb } from '../../lib/db/context';
import { carryOver, completeTask, dropTask } from '../../lib/db/review';
import { addToTop3, carryOverCandidates, removeFromTop3, swapIntoTop3 } from '../../lib/db/top3';
import type { Item } from '../../lib/schemas/records';
import { addDays } from '../../lib/holidays/easter';
import { deviceTimeZone } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';

const btn =
  'rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';

/** "Add to today's Top 3" on a task, with a swap choice when three are already picked (Task 5.8). */
export function Top3Button({ item }: { item: Item }) {
  const db = useDb();
  const today = todayKey();
  const [full, setFull] = useState<Item[] | null>(null);
  if (item.type !== 'task' || item.status !== 'open') return null;
  if (item.top3_date === today) {
    return (
      <button type="button" className={btn} onClick={() => void removeFromTop3(db, item.id)}>
        Remove from today’s Top 3
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        className={btn}
        onClick={() =>
          void addToTop3(db, item.id, today).then((r) => setFull(r.added ? null : r.full))
        }
      >
        Add to today’s Top 3
      </button>
      {full && (
        <div
          role="group"
          aria-label="Swap with"
          className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800"
        >
          <p className="mb-1 text-sm">Today’s Top 3 is full. Swap with:</p>
          <div className="flex flex-wrap gap-1">
            {full.map((f) => (
              <button
                key={f.id}
                type="button"
                className={btn}
                onClick={() =>
                  void swapIntoTop3(db, f.id, item.id, today).then(() => setFull(null))
                }
              >
                {f.title}
              </button>
            ))}
            <button type="button" className={`${btn} text-slate-500`} onClick={() => setFull(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Morning cards for yesterday's unfinished tasks: Done, Today or Drop (Task 5.8). */
export function CarryOverCards() {
  const db = useDb();
  const tz = deviceTimeZone();
  const today = todayKey();
  const items = useLiveQuery(
    async () =>
      carryOverCandidates(await db.items.where('type').equals('task').toArray(), today, tz),
    [db, today, tz],
  );
  if (!items?.length) return null;
  const yesterday = addDays(today, -1);
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        From yesterday
      </h2>
      <ul aria-label="From yesterday" className="space-y-2">
        {items.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
          >
            <span className="font-medium">{i.title}</span>
            <span className="flex gap-1">
              <button
                type="button"
                aria-label={`Done: ${i.title}`}
                className={btn}
                onClick={() => void completeTask(db, i.id)}
              >
                Done
              </button>
              <button
                type="button"
                aria-label={`Today: ${i.title}`}
                className={btn}
                onClick={() =>
                  void carryOver(db, i, yesterday, tz).then(() => addToTop3(db, i.id, today))
                }
              >
                Today
              </button>
              <button
                type="button"
                aria-label={`Drop: ${i.title}`}
                className={btn}
                onClick={() => void dropTask(db, i.id)}
              >
                Drop
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
