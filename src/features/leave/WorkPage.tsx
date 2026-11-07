import { useState } from 'react';
import { Link } from 'react-router';
import { Page } from '../../app/Page';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { leaveRangeText } from '../../lib/db/leave';
import { updateSettingsData } from '../../lib/db/settings';
import { leaveYearFor } from '../../lib/leave/engine';
import type { LeaveBooking } from '../../lib/schemas/records';
import { leaveTypeOf } from '../../lib/work/settings';
import LeaveCounter from './LeaveCounter';
import LeaveSheet from './LeaveSheet';
import { todayKey, useWork } from './useWork';

const section = 'mb-8 rounded-xl border border-slate-200 p-4 dark:border-slate-800';
const h2 = 'mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase';

/** Work and leave (Task 4.6): the leave counter, bookings and the year's opening balance. */
export default function WorkPage() {
  const db = useDb();
  const { user } = useAuth();
  const data = useWork();
  const [open, setOpen] = useState<{ booking?: LeaveBooking } | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  if (!data) return null;
  const { work, bookings } = data;
  const year = leaveYearFor(todayKey(), work);
  const inYear = bookings.filter((b) => b.end_date >= year.start && b.start_date <= year.end);
  const later = bookings.filter((b) => b.start_date > year.end);
  const opening = work.opening_carry_over[year.start];
  const show = (o: { booking?: LeaveBooking }) => {
    setOpen(o);
    setSheetKey((k) => k + 1);
  };

  const list = (rows: LeaveBooking[], label: string) => (
    <ul aria-label={label} className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            onClick={() => show({ booking: b })}
            className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <span>
              <span className="font-medium">{leaveRangeText(b)}</span>{' '}
              <span className="text-slate-500">· {leaveTypeOf(work, b.leave_type).name}</span>
            </span>
            <span className="shrink-0 text-slate-500">
              {b.days ?? '?'} d · {b.status}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Page title="Work and leave">
      <section className={section}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className={h2}>Leave this year</h2>
          <button
            type="button"
            onClick={() => show({})}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600"
          >
            Book leave
          </button>
        </div>
        {open && (
          <div className="mb-4 rounded-xl border border-emerald-200 p-3 dark:border-emerald-900">
            <LeaveSheet
              key={sheetKey}
              work={work}
              bookings={bookings}
              booking={open.booking}
              onClose={() => setOpen(null)}
            />
          </div>
        )}
        <LeaveCounter detailed />
      </section>

      <section className={section}>
        <h2 className={h2}>Bookings</h2>
        {inYear.length === 0 && later.length === 0 && (
          <p className="text-sm text-slate-500">No leave booked yet.</p>
        )}
        {inYear.length > 0 && list(inYear, 'This leave year')}
        {later.length > 0 && (
          <>
            <h3 className="mt-4 mb-1 text-sm font-medium">Next leave year</h3>
            {list(later, 'Next leave year')}
          </>
        )}
      </section>

      <section className={section}>
        <h2 className={h2}>Carried into this leave year</h2>
        <p className="mb-2 text-sm text-slate-500">
          Leave blank to work it out from last year’s bookings. Enter it here for your first year in
          Airhead, or to match what HR says.
        </p>
        <input
          type="number"
          min="0"
          step="0.5"
          aria-label="Days carried into this leave year"
          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          defaultValue={opening ?? ''}
          key={String(opening)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const next = Object.fromEntries(
              Object.entries(work.opening_carry_over).filter(([k]) => k !== year.start),
            );
            if (v !== '' && !Number.isNaN(Number(v))) next[year.start] = Math.max(0, Number(v));
            void updateSettingsData(db, user?.id ?? '', {
              work: { ...work, opening_carry_over: next },
            });
          }}
        />
        <p className="mt-4 text-sm">
          <Link to="/settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Work settings
          </Link>{' '}
          <span className="text-slate-500">(entitlement, leave year, holidays, locations)</span>
        </p>
      </section>
    </Page>
  );
}
