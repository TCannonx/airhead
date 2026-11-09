import { useState } from 'react';
import { useAuth } from '../../lib/auth/context';
import { locationFor } from '../../lib/calendar/sources';
import { useDb } from '../../lib/db/context';
import { setWorkLocation } from '../../lib/db/workDays';
import { WORK_LOCATIONS, type WorkLocation } from '../../lib/schemas/records';
import { LOCATION_LABELS } from '../../lib/work/settings';
import { useCalendarData } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';
import { Icon } from '../../app/Icon';
import { Chip } from '../../ui/Chip';
import { cx, FOCUS_RING } from '../../ui/cx';

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
        className={cx(
          'inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border/60 bg-surface px-3 text-footnote font-medium text-fg transition hover:bg-fill/60 disabled:opacity-70 pointer-coarse:min-h-11',
          FOCUS_RING,
        )}
      >
        <span className="text-fg-muted">Today:</span> {LOCATION_LABELS[current]}
        {onLeave && <span className="text-caption text-fg-muted">(on leave)</span>}
        {!onLeave && (
          <Icon
            name="chevron-right"
            className={cx('size-3.5 text-fg-subtle transition-transform', open && 'rotate-90')}
          />
        )}
      </button>
      {open && (
        <div role="group" aria-label="Where are you working?" className="mt-2 flex flex-wrap gap-2">
          {WORK_LOCATIONS.map((l) => (
            <Chip
              key={l}
              selected={l === current}
              onClick={() => choose(l)}
              className="pointer-coarse:min-h-11"
            >
              {LOCATION_LABELS[l]}
              {l === usual && l !== current ? ' (usual)' : ''}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
