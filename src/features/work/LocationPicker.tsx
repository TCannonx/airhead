import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { locationFor } from '../../lib/calendar/sources';
import { useDb } from '../../lib/db/context';
import { setWorkLocation } from '../../lib/db/workDays';
import { WORK_LOCATIONS, type WorkLocation } from '../../lib/schemas/records';
import { LOCATION_LABELS } from '../../lib/work/settings';
import { useCalendarData } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';

/**
 * Today's work location (Task 4.7): a chip that opens one-tap choices. Used on
 * Today (phone and tablet) and in the desktop side panel.
 */
export default function LocationPicker({ date = todayKey() }: { date?: string }) {
  const db = useDb();
  const { user } = useAuth();
  const data = useCalendarData();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const current = locationFor(date, data);
  const usual = locationFor(date, {
    ...data,
    workDays: data.workDays.filter((w) => w.date !== date),
  });
  const onLeave = data.leave.some(
    (b) => b.start_date <= date && b.end_date >= date && !b.start_half && !b.end_half,
  );

  const choose = (l: WorkLocation) => {
    setOpen(false);
    if (l !== current) void setWorkLocation(db, user?.id ?? '', date, l, usual);
  };

  return (
    <div className="mb-6">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Work location: ${LOCATION_LABELS[current]}. Change`}
        onClick={() => setOpen((o) => !o)}
        disabled={onLeave}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-sm font-medium hover:bg-slate-50 disabled:opacity-70 dark:border-slate-800 dark:hover:bg-slate-900"
      >
        <span className="text-slate-500">Today:</span> {LOCATION_LABELS[current]}
        {onLeave && <span className="text-xs text-slate-500">(on leave)</span>}
      </button>
      {open && (
        <div role="group" aria-label="Where are you working?" className="mt-2 flex flex-wrap gap-2">
          {WORK_LOCATIONS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === current}
              onClick={() => choose(l)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                l === current
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700'
              }`}
            >
              {LOCATION_LABELS[l]}
              {l === usual && l !== current ? ' (usual)' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
