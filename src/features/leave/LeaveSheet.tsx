import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { deleteLeave, saveLeave, type LeaveFields } from '../../lib/db/leave';
import { balanceFor, countLeaveDays, leaveYearFor } from '../../lib/leave/engine';
import { LEAVE_STATUSES, type LeaveBooking } from '../../lib/schemas/records';
import { leaveTypeOf, type WorkSettings } from '../../lib/work/settings';
import { todayKey } from './useWork';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { TextField } from '../../ui/TextField';
import { Toggle } from '../../ui/Toggle';

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
  inSheet = false,
}: {
  work: WorkSettings;
  bookings: LeaveBooking[];
  booking?: LeaveBooking;
  initial?: Partial<LeaveFields>;
  onClose: () => void;
  /** Inside a Sheet, which already shows the title and a Close button. */
  inSheet?: boolean;
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
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      {!inSheet && (
        <div className="flex items-center justify-between">
          <h2 className="text-headline">{booking ? 'Edit leave' : 'Book leave'}</h2>
          <Button size="sm" variant="plain" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="From"
          type="date"
          value={f.start_date}
          onChange={(e) => set('start_date', e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={f.end_date}
          min={f.start_date}
          onChange={(e) => set('end_date', e.target.value)}
        />
      </div>
      {single ? (
        <Select
          label="Day"
          value={f.start_half ? 'pm' : f.end_half ? 'am' : 'full'}
          onChange={(e) => {
            set('start_half', e.target.value === 'pm');
            set('end_half', e.target.value === 'am');
          }}
          options={[
            { value: 'full', label: 'Full day' },
            { value: 'am', label: 'Half day (morning off)' },
            { value: 'pm', label: 'Half day (afternoon off)' },
          ]}
        />
      ) : (
        <div>
          <Toggle
            label="First day starts at midday"
            checked={f.start_half}
            onChange={(v) => set('start_half', v)}
          />
          <Toggle
            label="Last day ends at midday"
            checked={f.end_half}
            onChange={(v) => set('end_half', v)}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Type"
          value={f.leave_type}
          onChange={(e) => set('leave_type', e.target.value)}
          options={work.leave_types.map((t) => ({ value: t.key, label: t.name }))}
        />
        <Select
          label="Status"
          value={f.status}
          onChange={(e) => set('status', e.target.value as LeaveBooking['status'])}
          options={LEAVE_STATUSES.map((st) => ({ value: st, label: STATUS_LABELS[st] }))}
        />
      </div>
      <Toggle
        label="Show as “Off” on the Us calendar"
        checked={f.share_us}
        onChange={(v) => set('share_us', v)}
      />
      <TextField
        label="Note"
        value={f.note ?? ''}
        onChange={(e) => set('note', e.target.value || null)}
      />
      <p aria-live="polite" className="text-footnote text-fg-muted">
        {!valid
          ? 'The last day is before the first.'
          : deducts
            ? `Uses ${days(cost)} of leave${after ? ` · ${days(after.remaining)} left after this` : ''}`
            : `${days(cost)} · not taken from your annual leave`}
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" type="submit" disabled={!valid}>
          {booking ? 'Save' : 'Book leave'}
        </Button>
        {booking && (
          <Button
            variant="destructive"
            className="ml-auto"
            onClick={() => void deleteLeave(db, booking.id).then(onClose)}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}
