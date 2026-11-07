import { Link } from 'react-router';
import { useDb } from '../../lib/db/context';
import { update } from '../../lib/db/repository';
import { completeTask } from '../../lib/db/review';
import { removeFromTop3 } from '../../lib/db/top3';
import type { Item } from '../../lib/schemas/records';
import { hhmmOf, slotTimes, type TodayView, type TopTask } from './useToday';

const h2 = 'mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase';

export function BriefLines({ view }: { view: TodayView }) {
  if (!view.brief?.content.reflection) return null;
  return (
    <p
      aria-label="Morning brief"
      className="mb-6 text-lg leading-snug text-slate-700 dark:text-slate-200"
    >
      {view.brief.content.reflection}
    </p>
  );
}

export function TodayEvents({ view }: { view: TodayView }) {
  if (view.events.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className={h2}>Today</h2>
      <ul aria-label="Today's events" className="space-y-1">
        {view.events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 text-sm">
            <span className="w-12 shrink-0 tabular-nums text-slate-500">
              {e.allDay ? 'All day' : hhmmOf(e.start)}
            </span>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: e.color }}
              />
              {e.title}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Done({ item }: { item: Item }) {
  const db = useDb();
  const done = item.status === 'done';
  return (
    <input
      type="checkbox"
      aria-label={`Done: ${item.title}`}
      checked={done}
      className="mt-1 size-5 shrink-0"
      onChange={() =>
        void (done
          ? update(db, 'items', item.id, { status: 'open', completed_at: null })
          : completeTask(db, item.id))
      }
    />
  );
}

function TopRow({ t, date, compact }: { t: TopTask; date: string; compact: boolean }) {
  const db = useDb();
  const blocked = !!t.item.start_at;
  return (
    <li className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <Done item={t.item} />
      <div className="min-w-0 flex-1">
        <p
          className={`font-medium ${t.item.status === 'done' ? 'text-slate-400 line-through' : ''}`}
        >
          {t.item.title}
        </p>
        {t.why && <p className="text-xs text-slate-500">{t.why}</p>}
        {t.item.status === 'open' &&
          (blocked ? (
            <p className="mt-1 text-xs text-slate-500">
              On the calendar at {hhmmOf(t.item.start_at ?? '')}
            </p>
          ) : t.slot ? (
            <button
              type="button"
              className="mt-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300"
              onClick={() =>
                void update(
                  db,
                  'items',
                  t.item.id,
                  slotTimes(date, t.slot ?? { start: '', end: '' }),
                )
              }
            >
              Block {t.slot.start}–{t.slot.end}
            </button>
          ) : (
            <p className="mt-1 text-xs text-slate-500">No free slot today</p>
          ))}
      </div>
      {!compact && t.item.status === 'open' && t.item.top3_date === date && (
        <button
          type="button"
          aria-label={`Remove from Top 3: ${t.item.title}`}
          className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => void removeFromTop3(db, t.item.id)}
        >
          ✕
        </button>
      )}
    </li>
  );
}

export function Top3({ view, compact = false }: { view: TodayView; compact?: boolean }) {
  return (
    <section className="mb-6">
      <h2 className={h2}>Top 3</h2>
      {view.top3.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing pressing today.</p>
      ) : (
        <ul aria-label="Top 3" className={compact ? 'space-y-1' : 'space-y-2'}>
          {view.top3.map((t) => (
            <TopRow key={t.item.id} t={t} date={view.date} compact={compact} />
          ))}
        </ul>
      )}
      {!view.brief && !compact && (
        <p className="mt-1 text-xs text-slate-500">
          Picked on this device (overdue, due today, then what keeps slipping) until the morning
          brief arrives.
        </p>
      )}
    </section>
  );
}

export function AlsoToday({ view }: { view: TodayView }) {
  if (view.also.length === 0) return null;
  return (
    <details className="mb-6">
      <summary className="cursor-pointer text-sm font-semibold text-slate-600 dark:text-slate-300">
        Also today ({view.also.length})
      </summary>
      <ul aria-label="Also today" className="mt-2 space-y-1">
        {view.also.map((i) => (
          <li key={i.id} className="flex items-start gap-3 text-sm">
            <Done item={i} />
            <Link to={`/library/item/${i.id}`} className="hover:underline">
              {i.title}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
