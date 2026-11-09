import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { localDate, localMidnight } from '../../lib/calendar/sources';
import { beforeText, prepRulesFor, readWorkSettings } from '../../lib/work/settings';
import { useAuth } from '../../lib/auth/context';
import { useDb } from '../../lib/db/context';
import { newItem, save, softDelete, update } from '../../lib/db/repository';
import type { Item } from '../../lib/schemas/records';
import StartNotesButton from '../notes/StartNotesButton';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { TextArea } from '../../ui/TextArea';
import { TextField } from '../../ui/TextField';
import { Toggle } from '../../ui/Toggle';
import { REMINDERS, REPEATS } from './eventOptions';
import { deviceTimeZone } from './useCalendarData';

/** What the editor opens with: an existing item, or a new event's times. */
export interface EventDraft {
  item?: Item;
  start: Date;
  end: Date | null;
  allDay: boolean;
}

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
    reminder: typeof item?.data.reminder_minutes === 'string' ? item.data.reminder_minutes : '',
  };
}

/** Create or edit an event (Task 4.2), shown in a Sheet whose title says which. */
export default function EventEditor({
  draft,
  onClose,
  onBookLeave,
}: {
  draft: EventDraft;
  onClose: () => void;
  /** Offered for a new all-day selection: book these days as leave instead. */
  onBookLeave?: (start: string, end: string) => void;
}) {
  const db = useDb();
  const { user } = useAuth();
  const settings = useLiveQuery(() => db.settings.get(user?.id ?? ''), [db, user?.id]);
  const tz = deviceTimeZone();
  const [f, setF] = useState(() => initialState(draft, tz));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const existing = draft.item;
  const isTask = existing?.type === 'task';
  const knownRepeat = REPEATS.some((r) => r.value === f.rrule);

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
        data: Object.fromEntries(
          Object.entries({
            ...existing.data,
            location: f.location.trim(),
            reminder_minutes: f.reminder,
          }).filter(([, v]) => v !== '' && v !== undefined),
        ),
      });
    } else {
      await save(
        db,
        'items',
        newItem(user?.id ?? '', {
          type: 'event',
          ...fields,
          data: {
            ...(f.location.trim() ? { location: f.location.trim() } : {}),
            ...(f.reminder ? { reminder_minutes: f.reminder } : {}),
          },
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
      <TextField
        label="Title"
        autoFocus
        value={f.title}
        onChange={(e) => set('title', e.target.value)}
      />
      {!isTask && (
        <Select
          label="Calendar"
          value={f.calendar}
          onChange={(e) => set('calendar', e.target.value as 'personal' | 'us')}
          options={[
            { value: 'personal', label: 'Personal' },
            { value: 'us', label: 'Us (shared)' },
          ]}
        />
      )}
      <Toggle label="All day" checked={f.allDay} onChange={(v) => set('allDay', v)} />
      {f.allDay ? (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="From"
            type="date"
            value={f.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          <TextField
            label="To"
            type="date"
            value={f.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TextField
            label="Starts"
            type="datetime-local"
            value={f.startTime}
            onChange={(e) => set('startTime', e.target.value)}
          />
          <TextField
            label="Ends"
            type="datetime-local"
            value={f.endTime}
            onChange={(e) => set('endTime', e.target.value)}
          />
        </div>
      )}
      {!isTask && (
        <Select
          label="Repeats"
          value={f.rrule}
          onChange={(e) => set('rrule', e.target.value)}
          options={[
            ...(knownRepeat ? [] : [{ value: f.rrule, label: `Custom (${f.rrule})` }]),
            ...REPEATS,
          ]}
        />
      )}
      {!isTask &&
        !f.rrule &&
        prepRulesFor(f.title, readWorkSettings(settings).prep_rules).map((r) => (
          <p key={r.id} className="text-footnote text-fg-muted">
            Before this: {r.reminder} ({beforeText(r.minutes_before)})
          </p>
        ))}
      {!f.allDay && !isTask && (
        <Select
          label="Reminder"
          value={f.reminder}
          onChange={(e) => set('reminder', e.target.value)}
          options={REMINDERS}
        />
      )}
      <TextField
        label="Location"
        value={f.location}
        onChange={(e) => set('location', e.target.value)}
      />
      <TextArea label="Notes" value={f.body} onChange={(e) => set('body', e.target.value)} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" variant="primary" disabled={!valid}>
          Save
        </Button>
        {!existing && f.allDay && onBookLeave && (
          <Button
            variant="plain"
            onClick={() =>
              onBookLeave(f.startDate, f.endDate < f.startDate ? f.startDate : f.endDate)
            }
          >
            Book as leave
          </Button>
        )}
        {existing && !isTask && (
          <StartNotesButton
            eventKey={existing.id}
            title={existing.title}
            date={f.allDay ? f.startDate : f.startTime.slice(0, 10)}
            className="inline-flex min-h-11 items-center rounded-control px-4 font-semibold text-accent hover:bg-accent-soft"
          />
        )}
        {existing && !isTask && (
          <Button
            variant="destructive"
            onClick={() => void softDelete(db, 'items', existing.id).then(onClose)}
          >
            Delete
          </Button>
        )}
        {existing && isTask && (
          <Button
            onClick={() =>
              void update(db, 'items', existing.id, {
                start_at: null,
                end_at: null,
                all_day: false,
              }).then(onClose)
            }
          >
            Remove from calendar
          </Button>
        )}
      </div>
    </form>
  );
}
