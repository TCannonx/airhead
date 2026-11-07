import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { deleteLeave, saveLeave, type LeaveFields } from '../../lib/db/leave';
import { balanceFor, countLeaveDays, leaveYearFor } from '../../lib/leave/engine';
import { LEAVE_STATUSES, type LeaveBooking } from '../../lib/schemas/records';
import { leaveTypeOf, type WorkSettings } from '../../lib/work/settings';
import { todayKey } from './useWork';

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const STATUS_LABELS: Record<LeaveBooking['status'], string> = {
  planned: 'Planned',
  requested: 'Requested',
  approved: 'Approved',
  taken: 'Taken',
};
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Book or edit leave (Task 4.6): dates, half days, type, status, share to Us. */
export default function LeaveSheet({
  work,
  bookings,
  booking,
  initial,
  onClose,
}: {
  work: WorkSettings;
  bookings: LeaveBooking[];
  booking?: LeaveBooking;
  initial?: Partial<LeaveFields>;
  onClose: () => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const today = todayKey();
  const [f, setF] = useState<LeaveFields>(() => ({
    start_date: booking?.start_date ?? initial?.start_date ?? today,
    end_date: booking?.end_date ?? initial?.end_date ?? initial?.start_date ?? today,
    start_half: booking?.start_half ?? initial?.start_half ?? false,
    end_half: booking?.end_half ?? initial?.end_half ?? false,
    leave_type: booking?.leave_type ?? initial?.leave_type ?? 'annual',
    status: booking?.status ?? initial?.status ?? 'planned',
    share_us: booking?.share_us ?? initial?.share_us ?? false,
    note: booking?.note ?? initial?.note ?? null,
    capture_id: booking?.capture_id ?? initial?.capture_id ?? null,
  }));
  const set = <K extends keyof LeaveFields>(k: K, v: LeaveFields[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const single = f.start_date === f.end_date;
  const valid = !!f.start_date && !!f.end_date && f.end_date >= f.start_date;
  const cost = valid ? countLeaveDays(f, work) : 0;
  const deducts = leaveTypeOf(work, f.leave_type).deducts;
  const others = bookings.filter((b) => b.id !== booking?.id);
  const after = valid
    ? balanceFor(leaveYearFor(f.start_date, work), [...others, f], work, today)
    : null;

  async function onSave() {
    if (!valid) return;
    await saveLeave(db, user?.id ?? '', f, work, booking);
    onClose();
  }

  return (
    <form
      aria-label={booking ? 'Edit leave' : 'Book leave'}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{booking ? 'Edit leave' : 'Book leave'}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          From
          <input
            type="date"
            className={field}
            value={f.start_date}
            onChange={(e) => set('start_date', e.target.value)}
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            className={field}
            value={f.end_date}
            min={f.start_date}
            onChange={(e) => set('end_date', e.target.value)}
          />
        </label>
      </div>
      {single ? (
        <label className="block text-sm">
          Day
          <select
            className={field}
            value={f.start_half ? 'pm' : f.end_half ? 'am' : 'full'}
            onChange={(e) => {
              set('start_half', e.target.value === 'pm');
              set('end_half', e.target.value === 'am');
            }}
          >
            <option value="full">Full day</option>
            <option value="am">Half day (morning off)</option>
            <option value="pm">Half day (afternoon off)</option>
          </select>
        </label>
      ) : (
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={f.start_half}
              onChange={(e) => set('start_half', e.target.checked)}
            />
            First day starts at midday
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={f.end_half}
              onChange={(e) => set('end_half', e.target.checked)}
            />
            Last day ends at midday
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Type
          <select
            className={field}
            value={f.leave_type}
            onChange={(e) => set('leave_type', e.target.value)}
          >
            {work.leave_types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select
            className={field}
            value={f.status}
            onChange={(e) => set('status', e.target.value as LeaveBooking['status'])}
          >
            {LEAVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.share_us}
          onChange={(e) => set('share_us', e.target.checked)}
        />
        Show as “Off” on the Us calendar
      </label>
      <label className="block text-sm">
        Note
        <input
          className={field}
          value={f.note ?? ''}
          onChange={(e) => set('note', e.target.value || null)}
        />
      </label>
      <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">
        {!valid
          ? 'The last day is before the first.'
          : deducts
            ? `Uses ${days(cost)} of leave${after ? ` · ${days(after.remaining)} left after this` : ''}`
            : `${days(cost)} · not taken from your annual leave`}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {booking ? 'Save' : 'Book leave'}
        </button>
        {booking && (
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => void deleteLeave(db, booking.id).then(onClose)}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
