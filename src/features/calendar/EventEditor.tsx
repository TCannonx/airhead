import { useState } from 'react';
import { localDate, localMidnight } from '../../lib/calendar/sources';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { newItem, save, softDelete, update } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';
import { deviceTimeZone } from './useCalendarData';

/** What the editor opens with: an existing item, or a new event's times. */
export interface EventDraft {
  item?: Item;
  start: Date;
  end: Date | null;
  allDay: boolean;
}

const REPEATS: [string, string][] = [
  ['', 'Does not repeat'],
  ['FREQ=DAILY', 'Every day'],
  ['FREQ=WEEKLY', 'Every week'],
  ['FREQ=MONTHLY', 'Every month'],
  ['FREQ=YEARLY', 'Every year'],
];

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900';
const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as the value of a datetime-local input (device time). */
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function initialState(d: EventDraft, tz: string) {
  const item = d.item;
  const start = item?.start_at ? new Date(item.start_at) : d.start;
  const allDay = item ? item.all_day : d.allDay;
  const end = item?.end_at
    ? new Date(item.end_at)
    : (d.end ?? (allDay ? null : new Date(start.getTime() + 3_600_000)));
  // A new all-day selection's end is exclusive; the form shows the last day.
  const lastDay = allDay
    ? item
      ? end && localDate(end, tz)
      : end && localDate(new Date(end.getTime() - 86_400_000), tz)
    : null;
  return {
    title: item?.title ?? '',
    calendar: (item?.calendar ?? 'personal') as 'personal' | 'us',
    allDay,
    startDate: localDate(start, tz),
    endDate: lastDay ?? localDate(start, tz),
    startTime: toLocalInput(start),
    endTime: toLocalInput(end ?? new Date(start.getTime() + 3_600_000)),
    location: typeof item?.data.location === 'string' ? item.data.location : '',
    body: item?.body ?? '',
    rrule: item?.rrule ?? '',
  };
}

/** Create or edit an event (Task 4.2): side panel on desktop, sheet on phone. */
export default function EventEditor({
  draft,
  onClose,
}: {
  draft: EventDraft;
  onClose: () => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const tz = deviceTimeZone();
  const [f, setF] = useState(() => initialState(draft, tz));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const existing = draft.item;
  const isTask = existing?.type === 'task';
  const knownRepeat = REPEATS.some(([v]) => v === f.rrule);

  const times = () => {
    if (f.allDay) {
      const last = f.endDate < f.startDate ? f.startDate : f.endDate;
      return {
        start_at: localMidnight(f.startDate, tz),
        end_at: last > f.startDate ? localMidnight(last, tz) : null,
        all_day: true,
      };
    }
    const start = new Date(f.startTime);
    const end = new Date(f.endTime);
    return {
      start_at: start.toISOString(),
      end_at: (end > start ? end : new Date(start.getTime() + 3_600_000)).toISOString(),
      all_day: false,
    };
  };
  const valid = f.title.trim() && (f.allDay || !Number.isNaN(Date.parse(f.startTime)));

  async function onSave() {
    if (!valid) return;
    const fields = {
      title: f.title.trim(),
      body: f.body.trim() || null,
      ...times(),
      ...(isTask ? {} : { calendar: f.calendar, rrule: f.rrule || null }),
    };
    if (existing) {
      await update(db, 'items', existing.id, {
        ...fields,
        data: { ...existing.data, location: f.location.trim() || undefined },
      });
    } else {
      await save(
        db,
        'items',
        newItem(user?.id ?? '', {
          type: 'event',
          ...fields,
          data: f.location.trim() ? { location: f.location.trim() } : {},
        }),
      );
    }
    onClose();
  }

  return (
    <form
      aria-label={existing ? 'Edit event' : 'New event'}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {existing ? (isTask ? 'Edit time block' : 'Edit event') : 'New event'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>
      <label className="block text-sm">
        Title
        <input
          autoFocus
          className={field}
          value={f.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </label>
      {!isTask && (
        <label className="block text-sm">
          Calendar
          <select
            className={field}
            value={f.calendar}
            onChange={(e) => set('calendar', e.target.value as 'personal' | 'us')}
          >
            <option value="personal">Personal</option>
            <option value="us">Us (shared)</option>
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.allDay}
          onChange={(e) => set('allDay', e.target.checked)}
        />
        All day
      </label>
      {f.allDay ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            From
            <input
              type="date"
              className={field}
              value={f.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <input
              type="date"
              className={field}
              value={f.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-sm">
            Starts
            <input
              type="datetime-local"
              className={field}
              value={f.startTime}
              onChange={(e) => set('startTime', e.target.value)}
            />
          </label>
          <label className="text-sm">
            Ends
            <input
              type="datetime-local"
              className={field}
              value={f.endTime}
              onChange={(e) => set('endTime', e.target.value)}
            />
          </label>
        </div>
      )}
      {!isTask && (
        <label className="block text-sm">
          Repeats
          <select className={field} value={f.rrule} onChange={(e) => set('rrule', e.target.value)}>
            {!knownRepeat && <option value={f.rrule}>Custom ({f.rrule})</option>}
            {REPEATS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm">
        Location
        <input
          className={field}
          value={f.location}
          onChange={(e) => set('location', e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Notes
        <textarea
          rows={3}
          className={field}
          value={f.body}
          onChange={(e) => set('body', e.target.value)}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Save
        </button>
        {existing && !isTask && (
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => void softDelete(db, 'items', existing.id).then(onClose)}
          >
            Delete
          </button>
        )}
        {existing && isTask && (
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() =>
              void update(db, 'items', existing.id, {
                start_at: null,
                end_at: null,
                all_day: false,
              }).then(onClose)
            }
          >
            Remove from calendar
          </button>
        )}
      </div>
    </form>
  );
}
