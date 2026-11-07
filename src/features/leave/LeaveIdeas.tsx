import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import type { Bridge } from '../../lib/leave/bridges';
import { leaveBridges, leaveContext, type LeaveData } from '../../lib/leave/suggest';
import { useOnline } from '../../lib/useOnline';
import type { LeaveBooking } from '../../lib/schemas/records';
import type { WorkSettings } from '../../lib/work/settings';
import { todayKey } from './useWork';

const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${d}T12:00:00Z`),
  );

/**
 * Suggest leave (Task 8.8): bridge days found in code from this device's own
 * data (free, offline), and optionally one small AI call that picks two or
 * three and says why. "Book" opens the normal leave sheet, prefilled.
 */
export default function LeaveIdeas({
  work,
  bookings,
  onBook,
}: {
  work: WorkSettings;
  bookings: LeaveBooking[];
  onBook: (b: Bridge) => void;
}) {
  const db = useDb();
  const { services } = useAuth();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<{ index: number; why: string }[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const today = todayKey();
  const data = useLiveQuery(async (): Promise<LeaveData> => {
    const [events, external] = await Promise.all([
      db.items.where('type').equals('event').toArray(),
      db.external_events.toArray(),
    ]);
    return { work, bookings, events, external, today };
  }, [db, work, bookings, today]);

  if (!open)
    return (
      <button
        type="button"
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
        onClick={() => setOpen(true)}
      >
        Suggest leave
      </button>
    );
  if (!data) return null;
  const bridges = leaveBridges(data);
  const shown = picks
    ? picks.map((p) => ({ b: bridges[p.index], why: p.why }))
    : bridges.map((b) => ({ b, why: null }));

  const ask = async () => {
    if (!services.leave) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await services.leave.suggest({
        today,
        candidates: bridges.map((b) => ({
          leave: b.leave,
          start: b.start,
          end: b.end,
          days_off: b.daysOff,
        })),
        context: leaveContext(data),
      });
      if (res.ok) setPicks(res.picks);
      else setMessage(res.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Leave ideas"
      className="space-y-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800"
    >
      <h3 className="font-semibold">
        {picks ? 'Airhead’s picks' : 'Good bridges in the next six months'}
      </h3>
      {bridges.length === 0 ? (
        <p className="text-slate-500">No good bridges ahead (or no leave left to book).</p>
      ) : (
        <ul className="space-y-2">
          {shown.map(({ b, why }) =>
            b ? (
              <li
                key={`${b.start}:${b.end}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  <span className="font-medium">
                    {b.leave.length} {b.leave.length === 1 ? 'day' : 'days'} off (
                    {b.leave.map(fmt).join(' and ')}) → {b.daysOff} days, {fmt(b.start)} to{' '}
                    {fmt(b.end)}
                  </span>
                  {why && <span className="block text-slate-500">{why}</span>}
                </span>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
                  onClick={() => onBook(b)}
                >
                  Book {b.leave.map(fmt).join(' and ')}
                </button>
              </li>
            ) : null,
          )}
        </ul>
      )}
      {services.leave && bridges.length > 1 && !picks && (
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <button
            type="button"
            className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800"
            disabled={busy || !online}
            onClick={() => void ask()}
          >
            {busy ? 'Thinking…' : 'Ask Airhead to pick'}
          </button>
          <span>{online ? 'One small AI call, ≈ €0.001.' : 'Needs a connection.'}</span>
        </div>
      )}
      {message && (
        <p role="status" className="text-amber-700 dark:text-amber-400">
          {message}
        </p>
      )}
    </section>
  );
}
