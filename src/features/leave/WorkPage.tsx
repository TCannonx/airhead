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
import LeaveIdeas from './LeaveIdeas';
import LeaveSheet from './LeaveSheet';
import { todayKey, useWork } from './useWork';
import { Button } from '../../ui/Button';

const section = 'mb-8 rounded-card border border-border/60 p-4 ';
const h2 = 'mb-3 text-footnote font-semibold tracking-wide text-fg-muted uppercase';

/** Work and leave (Task 4.6): the leave counter, bookings and the year's opening balance. */
export default function WorkPage() {
  const db = useDb();
  const { user } = useAuth();
  const data = useWork();
  const [open, setOpen] = useState<{
    booking?: LeaveBooking;
    initial?: { start_date: string; end_date: string };
  } | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  if (!data) return null;
  const { work, bookings } = data;
  const year = leaveYearFor(todayKey(), work);
  const inYear = bookings.filter((b) => b.end_date >= year.start && b.start_date <= year.end);
  const later = bookings.filter((b) => b.start_date > year.end);
  const opening = work.opening_carry_over[year.start];
  const usedBefore = work.opening_used[year.start];
  const show = (o: {
    booking?: LeaveBooking;
    initial?: { start_date: string; end_date: string };
  }) => {
    setOpen(o);
    setSheetKey((k) => k + 1);
  };

  const list = (rows: LeaveBooking[], label: string) => (
    <ul aria-label={label} className="divide-y divide-border/70">
      {rows.map((b) => (
        <li key={b.id}>
          <Button size="sm" className="w-full" onClick={() => show({ booking: b })}>
            <span>
              <span className="font-medium">{leaveRangeText(b)}</span>{' '}
              <span className="text-fg-muted">· {leaveTypeOf(work, b.leave_type).name}</span>
            </span>
            <span className="shrink-0 text-fg-muted">
              {b.days ?? '?'} d · {b.status}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <Page title="Work and leave">
      <section className={section}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className={h2}>Leave this year</h2>
          <Button variant="primary" size="sm" onClick={() => show({})}>
            Book leave
          </Button>
        </div>
        {open && (
          <div className="mb-4 rounded-card border border-border/60 p-3">
            <LeaveSheet
              key={sheetKey}
              work={work}
              bookings={bookings}
              booking={open.booking}
              initial={open.initial}
              onClose={() => setOpen(null)}
            />
          </div>
        )}
        <LeaveCounter detailed />
        <div className="mt-4">
          <LeaveIdeas
            work={work}
            bookings={bookings}
            onBook={(b) =>
              show({
                initial: { start_date: b.leave[0] ?? b.start, end_date: b.leave.at(-1) ?? b.end },
              })
            }
          />
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Bookings</h2>
        {inYear.length === 0 && later.length === 0 && (
          <p className="text-footnote text-fg-muted">No leave booked yet.</p>
        )}
        {inYear.length > 0 && list(inYear, 'This leave year')}
        {later.length > 0 && (
          <>
            <h3 className="mt-4 mb-1 text-footnote font-medium">Next leave year</h3>
            {list(later, 'Next leave year')}
          </>
        )}
      </section>

      <section className={section}>
        <h2 className={h2}>Carried into this leave year</h2>
        <p className="mb-2 text-footnote text-fg-muted">
          Leave blank to work it out from last year’s bookings. Enter it here for your first year in
          Airhead, or to match what HR says.
        </p>
        <input
          type="number"
          min="0"
          step="0.5"
          aria-label="Days carried into this leave year"
          className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-footnote"
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
        <p className="mt-4 text-footnote">
          <Link to="/settings" className="text-accent hover:underline">
            Work settings
          </Link>{' '}
          <span className="text-fg-muted">(entitlement, leave year, holidays, locations)</span>
        </p>
      </section>

      <section className={section}>
        <h2 className={h2}>Used before Airhead</h2>
        <p className="mb-2 text-footnote text-fg-muted">
          Leave you took this leave year before you started logging it here. It counts as taken.
        </p>
        <input
          type="number"
          min="0"
          step="0.5"
          aria-label="Days used before Airhead"
          className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-footnote"
          defaultValue={usedBefore ?? ''}
          key={String(usedBefore)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const next = Object.fromEntries(
              Object.entries(work.opening_used).filter(([k]) => k !== year.start),
            );
            if (v !== '' && !Number.isNaN(Number(v))) next[year.start] = Math.max(0, Number(v));
            void updateSettingsData(db, user?.id ?? '', {
              work: { ...work, opening_used: next },
            });
          }}
        />
      </section>
    </Page>
  );
}
