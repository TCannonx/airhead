import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { localDate, localMidnight } from '../../lib/calendar/sources';
import { addDays } from '../../lib/holidays/easter';
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
import { Chip } from '../../ui/Chip';
import {
  buildRepeat,
  formCanEdit,
  readRepeat,
  repeatWords,
  weekdayOf,
  WEEKDAYS,
  type Ends,
  type Freq,
  type RepeatForm,
} from '../../lib/calendar/repeat';
import { REMINDERS, REPEATS } from './eventOptions';
import RepeatChoice from './RepeatChoice';
import type { OccurrenceChanges, Scope } from '../../lib/calendar/occurrence';
import { deleteOccurrence, editOccurrence } from '../../lib/db/recurring';
import { deviceTimeZone } from './useCalendarData';

/** What the editor opens with: an existing item, or a new event's times. */
export interface EventDraft {
  item?: Item;
  start: Date;
  end: Date | null;
  allDay: boolean;
  /** Quick add's "More options": the parsed title, repeat and calendar. */
  title?: string;
  rrule?: string | null;
  calendar?: 'personal' | 'us';
  /** The occurrence of a repeating item being edited (its original start, ISO). */
  occurrence?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as the value of a datetime-local input (device time). */
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function initialState(d: EventDraft, tz: string) {
  const item = d.item;
  // One occurrence of a repeating event shows that occurrence's own times.
  const shift =
    item?.start_at && d.occurrence ? Date.parse(d.occurrence) - Date.parse(item.start_at) : 0;
  const start = item?.start_at ? new Date(Date.parse(item.start_at) + shift) : d.start;
  const allDay = item ? item.all_day : d.allDay;
  const end = item?.end_at
    ? new Date(Date.parse(item.end_at) + shift)
    : (d.end ?? (allDay ? null : new Date(start.getTime() + 3_600_000)));
  // A new all-day selection's end is exclusive; the form shows the last day.
  const lastDay = allDay
    ? item
      ? item.start_at && item.end_at
        ? // Same number of days as the series, counted in local days (clock changes).
          addDays(
            localDate(start, tz),
            Math.round(
              (Date.parse(localDate(item.end_at, tz)) - Date.parse(localDate(item.start_at, tz))) /
                86_400_000,
            ),
          )
        : null
      : end && localDate(new Date(end.getTime() - 86_400_000), tz)
    : null;
  const rrule = item ? item.rrule : (d.rrule ?? null);
  return {
    title: item?.title ?? d.title ?? '',
    calendar: (item?.calendar ?? d.calendar ?? 'personal') as 'personal' | 'us',
    allDay,
    startDate: localDate(start, tz),
    endDate: lastDay ?? localDate(start, tz),
    startTime: toLocalInput(start),
    endTime: toLocalInput(end ?? new Date(start.getTime() + 3_600_000)),
    location: typeof item?.data.location === 'string' ? item.data.location : '',
    body: item?.body ?? '',
    rrule: rrule ?? '',
    repeat: readRepeat(rrule, localDate(start, tz)),
    /** False until the repeat fields change: the rule is saved exactly as it was. */
    repeatTouched: false,
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
  const [choosing, setChoosing] = useState<'save' | 'delete' | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const existing = draft.item;
  const isTask = existing?.type === 'task';
  const editable = f.repeatTouched || formCanEdit(f.rrule);
  const startDay = f.allDay ? f.startDate : f.startTime.slice(0, 10);
  const setRepeat = (changes: Partial<RepeatForm>) =>
    setF((p) => ({ ...p, repeat: { ...p.repeat, ...changes }, repeatTouched: true }));
  const rule = f.repeatTouched ? buildRepeat(f.repeat) : f.rrule || null;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year', '': '' }[
    f.repeat.freq
  ];

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

  const occurrenceChanges = (): OccurrenceChanges => ({
    title: f.title.trim(),
    body: f.body.trim() || null,
    ...times(),
    calendar: f.calendar,
    rrule: rule,
    data: { location: f.location.trim(), reminder_minutes: f.reminder },
  });

  async function onChoose(scope: Scope) {
    const series = existing;
    const occurrence = draft.occurrence;
    if (!series || !occurrence) return;
    if (choosing === 'delete') await deleteOccurrence(db, series, occurrence, scope, tz);
    else await editOccurrence(db, series, occurrence, scope, occurrenceChanges(), tz);
    onClose();
  }

  async function onSave() {
    if (!valid) return;
    const fields = {
      title: f.title.trim(),
      body: f.body.trim() || null,
      ...times(),
      ...(isTask ? {} : { calendar: f.calendar, rrule: rule }),
    };
    if (existing?.rrule && draft.occurrence && !isTask) {
      setChoosing('save');
      return;
    }
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
          value={editable ? (f.repeat.freq ? `FREQ=${f.repeat.freq}` : '') : 'custom'}
          onChange={(e) => {
            const freq = e.target.value.replace('FREQ=', '') as Freq;
            setRepeat({
              freq,
              ...(freq === 'WEEKLY' && f.repeat.byDay.length === 0
                ? { byDay: [weekdayOf(startDay)] }
                : {}),
            });
          }}
          options={[
            ...(editable ? [] : [{ value: 'custom', label: `Custom (${f.rrule})` }]),
            ...REPEATS,
          ]}
        />
      )}
      {!isTask && editable && f.repeat.freq && (
        <div className="space-y-3 rounded-card border border-border p-3">
          <div className="flex items-end gap-2">
            <TextField
              label="Every"
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              className="w-24"
              value={f.repeat.interval ? String(f.repeat.interval) : ''}
              onChange={(e) => setRepeat({ interval: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="pb-3 text-body text-fg-muted">
              {unit}
              {f.repeat.interval > 1 ? 's' : ''}
            </span>
          </div>
          {f.repeat.freq === 'WEEKLY' && (
            <div role="group" aria-label="On days" className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const on = f.repeat.byDay.includes(w.code);
                return (
                  <Chip
                    key={w.code}
                    selected={on}
                    onClick={() =>
                      setRepeat({
                        byDay: on
                          ? f.repeat.byDay.filter((d) => d !== w.code)
                          : [...f.repeat.byDay, w.code],
                      })
                    }
                  >
                    {w.short}
                  </Chip>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="End repeat"
              value={f.repeat.ends}
              onChange={(e) => setRepeat({ ends: e.target.value as Ends })}
              options={[
                { value: 'never', label: 'Never' },
                { value: 'on', label: 'On a date' },
                { value: 'after', label: 'After a number of times' },
              ]}
            />
            {f.repeat.ends === 'on' && (
              <TextField
                label="End date"
                type="date"
                value={f.repeat.until}
                onChange={(e) => setRepeat({ until: e.target.value })}
              />
            )}
            {f.repeat.ends === 'after' && (
              <TextField
                label="Times"
                type="number"
                min={1}
                inputMode="numeric"
                value={f.repeat.count ? String(f.repeat.count) : ''}
                onChange={(e) => setRepeat({ count: Math.max(0, Number(e.target.value) || 0) })}
              />
            )}
          </div>
        </div>
      )}
      {!isTask && rule && (
        <p data-testid="repeat-summary" aria-live="polite" className="text-footnote text-fg-muted">
          {repeatWords(rule, startDay)}
        </p>
      )}
      {!isTask &&
        !rule &&
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
      {choosing ? (
        <RepeatChoice
          question={
            choosing === 'delete' ? 'Delete this repeating event?' : 'Save for which events?'
          }
          destructive={choosing === 'delete'}
          allowThis={choosing === 'delete' || rule === existing?.rrule}
          onCancel={() => setChoosing(null)}
          onChoose={(scope) => void onChoose(scope)}
        />
      ) : (
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
              onClick={() =>
                existing.rrule && draft.occurrence
                  ? setChoosing('delete')
                  : void softDelete(db, 'items', existing.id).then(onClose)
              }
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
      )}
    </form>
  );
}
