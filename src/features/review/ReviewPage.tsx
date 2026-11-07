import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useDb } from '../../lib/db/context';
import { carryOver, completeTask, dropTask, reviewTasks } from '../../lib/db/review';
import { deviceTimeZone } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';

const btn =
  'rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800';

/** The evening review (Task 4.14): opened from the 21:00 notification or from Today. */
export default function ReviewPage() {
  const db = useDb();
  const tz = deviceTimeZone();
  const today = todayKey();
  const tasks = useLiveQuery(
    async () => reviewTasks(await db.items.where('type').equals('task').toArray(), today, tz),
    [db, today, tz],
  );
  if (!tasks) return null;

  return (
    <Page title="Evening review">
      {tasks.length === 0 ? (
        <div className="space-y-2">
          <p className="text-lg">All done for today.</p>
          <Link to="/today" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Back to Today
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">
            {tasks.length} open task{tasks.length === 1 ? '' : 's'} from today. Tick off what’s
            done, carry the rest to tomorrow, or let it go.
          </p>
          <ul aria-label="Today's open tasks" className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <span className="min-w-0">
                  <span className="font-medium">{t.title}</span>
                  {t.carry_count > 0 && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                      carried over {t.carry_count}×
                    </span>
                  )}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Done: ${t.title}`}
                    className={`${btn} text-emerald-700 dark:text-emerald-400`}
                    onClick={() => void completeTask(db, t.id)}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    aria-label={`Carry over: ${t.title}`}
                    className={btn}
                    onClick={() => void carryOver(db, t, today, tz)}
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    aria-label={`Drop: ${t.title}`}
                    className={`${btn} text-slate-500`}
                    onClick={() => void dropTask(db, t.id)}
                  >
                    Drop
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {tasks.length > 1 && (
            <button
              type="button"
              className={`${btn} mt-4`}
              onClick={() => void Promise.all(tasks.map((t) => carryOver(db, t, today, tz)))}
            >
              Carry all to tomorrow
            </button>
          )}
        </>
      )}
    </Page>
  );
}
