import { TZDate } from '@date-fns/tz';
import { RRule } from 'rrule';
import { addDays, weekday } from '../holidays/easter';
import { holidaysBetween } from '../holidays/ie';
import type {
  ExternalEvent,
  Feed,
  Item,
  LeaveBooking,
  Series,
  WorkDay,
  WorkLocation,
} from '../schemas/records';
import { leaveTypeOf, patternLocation, type WorkSettings } from '../work/settings';

/**
 * Maps Airhead's records to calendar events (Task 4.2). Pure functions, so the
 * mapping is unit-tested without rendering FullCalendar. Recurring items are
 * expanded here (not by a FullCalendar plugin) in the person's time zone, so a
 * weekly 19:00 stays at 19:00 across the clock change.
 */
export type SourceKey = 'personal' | 'us' | 'tasks' | 'holidays' | 'leave' | `feed:${string}`;

export const SOURCE_COLOURS: Record<
  'personal' | 'us' | 'tasks' | 'holidays' | 'leave' | 'linked',
  string
> = {
  personal: '#4f46e5',
  us: '#e11d48',
  tasks: '#b45309',
  holidays: '#475569',
  leave: '#047857',
  linked: '#0f766e',
};

export const SOURCE_LABELS: Record<'personal' | 'us' | 'tasks' | 'holidays' | 'leave', string> = {
  personal: 'Personal',
  us: 'Us',
  tasks: 'Time-blocked tasks',
  holidays: 'Public holidays',
  leave: 'Leave',
};

export interface CalEvent {
  id: string;
  title: string;
  /** ISO instant for timed events; YYYY-MM-DD for all-day ones. */
  start: string;
  end?: string;
  allDay: boolean;
  color: string;
  editable: boolean;
  /** Drag start and resize; false for recurring and read-only events. */
  className?: string;
  extendedProps: {
    source: SourceKey;
    itemId?: string;
    occurrence?: string;
    /** external_events id, for a linked calendar's event. */
    externalId?: string;
    /** leave_bookings id. */
    leaveId?: string;
  };
}

export interface CalendarData {
  items: Item[];
  external: ExternalEvent[];
  feeds: Feed[];
  leave: LeaveBooking[];
  workDays: WorkDay[];
  work: WorkSettings;
  /** Imported series: a series colour, when set, colours its events. */
  series?: Series[];
}

export interface Range {
  start: Date;
  end: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The YYYY-MM-DD date of an instant in a time zone. */
export function localDate(iso: string | Date, timeZone: string): string {
  const d = new TZDate(new Date(iso).getTime(), timeZone);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The instant of local midnight on a YYYY-MM-DD date, as plain UTC ISO. */
export function localMidnight(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(new TZDate(y, m - 1, d, timeZone).getTime()).toISOString();
}

export function sourceOfItem(item: Item): SourceKey {
  if (item.type === 'task') return 'tasks';
  return item.calendar === 'us' ? 'us' : 'personal';
}

/** Items that belong on the calendar: open events and time-blocked tasks. */
export function isCalendarItem(item: Item): boolean {
  if (item.deleted_at || !item.start_at) return false;
  if (item.type === 'event') return item.status === 'open';
  if (item.type === 'task') return item.status === 'open' || item.status === 'done';
  return false;
}

/** Occurrence starts (ISO instants) of a recurring item inside a range. */
export function expandOccurrences(item: Item, range: Range, timeZone: string): string[] {
  if (!item.start_at || !item.rrule) return [];
  const s = new TZDate(new Date(item.start_at).getTime(), timeZone);
  // rrule works on "floating" wall-clock times: encode local time as UTC and back.
  const floating = (d: TZDate) =>
    new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
  let options;
  try {
    options = RRule.parseString(item.rrule.replace(/^RRULE:/, ''));
  } catch {
    return [];
  }
  const rule = new RRule({ ...options, dtstart: floating(s) });
  const from = floating(new TZDate(range.start.getTime() - 86_400_000, timeZone));
  const to = floating(new TZDate(range.end.getTime() + 86_400_000, timeZone));
  return rule
    .between(from, to, true)
    .map((o) =>
      new Date(
        new TZDate(
          o.getUTCFullYear(),
          o.getUTCMonth(),
          o.getUTCDate(),
          o.getUTCHours(),
          o.getUTCMinutes(),
          timeZone,
        ).getTime(),
      ).toISOString(),
    )
    .filter((iso) => {
      const t = Date.parse(iso);
      return t < range.end.getTime() && t >= range.start.getTime() - 86_400_000;
    });
}

/** One item (or one occurrence of a repeating item) as a calendar event. */
export function eventForItem(
  item: Item,
  start: string,
  timeZone: string,
  occurrence?: string,
  colour?: string | null,
): CalEvent {
  const source = sourceOfItem(item);
  const duration =
    item.start_at && item.end_at ? Date.parse(item.end_at) - Date.parse(item.start_at) : null;
  const end = duration !== null ? new Date(Date.parse(start) + duration).toISOString() : null;
  const base = {
    id: occurrence ? `${item.id}|${occurrence}` : item.id,
    title: item.type === 'task' && item.status === 'done' ? `✓ ${item.title}` : item.title,
    color: colour ?? SOURCE_COLOURS[source as 'personal'],
    editable: !item.rrule,
    extendedProps: { source, itemId: item.id, ...(occurrence ? { occurrence } : {}) },
  };
  if (item.all_day) {
    const first = localDate(start, timeZone);
    // Stored all-day end is the last day (inclusive); FullCalendar's end is exclusive.
    const last = end ? localDate(end, timeZone) : first;
    return { ...base, allDay: true, start: first, end: addDays(last < first ? first : last, 1) };
  }
  return { ...base, allDay: false, start, ...(end ? { end } : {}) };
}

function overlaps(startIso: string, endIso: string | null, range: Range): boolean {
  const s = Date.parse(startIso);
  const e = endIso ? Date.parse(endIso) : s;
  return s < range.end.getTime() && e >= range.start.getTime();
}

/** A linked calendar's event (read-only). */
export function eventForExternal(e: ExternalEvent, feed: Feed, timeZone: string): CalEvent {
  const base = {
    id: `ext:${e.id}`,
    title: e.title || '(busy)',
    color: feed.colour ?? SOURCE_COLOURS.linked,
    editable: false,
    extendedProps: { source: `feed:${feed.id}` as SourceKey, externalId: e.id },
  };
  return e.all_day
    ? {
        ...base,
        allDay: true,
        start: localDate(e.start_at, timeZone),
        end: e.end_at ? localDate(e.end_at, timeZone) : addDays(localDate(e.start_at, timeZone), 1),
      }
    : { ...base, allDay: false, start: e.start_at, ...(e.end_at ? { end: e.end_at } : {}) };
}

/** Every calendar event in a range, for the sources that are not hidden. */
export function buildEvents(
  data: CalendarData,
  range: Range,
  timeZone: string,
  hidden: ReadonlySet<string> = new Set(),
): CalEvent[] {
  const out: CalEvent[] = [];
  const show = (k: SourceKey) => !hidden.has(k);
  const startDate = localDate(range.start, timeZone);
  const endDate = localDate(new Date(range.end.getTime() - 1), timeZone);

  const seriesColour = new Map(
    (data.series ?? []).filter((x) => !x.deleted_at && x.colour).map((x) => [x.id, x.colour]),
  );
  const colourOf = (i: Item) => (i.series_id ? seriesColour.get(i.series_id) : undefined);
  for (const item of data.items) {
    if (!isCalendarItem(item) || !show(sourceOfItem(item)) || !item.start_at) continue;
    if (item.rrule) {
      for (const occ of expandOccurrences(item, range, timeZone)) {
        out.push(eventForItem(item, occ, timeZone, occ, colourOf(item)));
      }
    } else if (overlaps(item.start_at, item.end_at, range)) {
      out.push(eventForItem(item, item.start_at, timeZone, undefined, colourOf(item)));
    }
  }

  const feeds = new Map(data.feeds.map((f) => [f.id, f]));
  for (const e of data.external) {
    const feed = feeds.get(e.feed_id);
    if (e.deleted_at || !feed || feed.deleted_at || !feed.enabled) continue;
    if (!show(`feed:${feed.id}`) || !overlaps(e.start_at, e.end_at, range)) continue;
    out.push(eventForExternal(e, feed, timeZone));
  }

  if (show('holidays')) {
    for (const h of holidaysBetween(startDate, endDate, data.work.manual_holidays)) {
      out.push({
        id: `hol:${h.date}`,
        title: h.kind === 'common' ? `${h.name} (usual day off)` : h.name,
        start: h.date,
        end: addDays(h.date, 1),
        allDay: true,
        color: SOURCE_COLOURS.holidays,
        editable: false,
        className: h.kind === 'common' ? 'ah-common-day' : 'ah-holiday',
        extendedProps: { source: 'holidays' },
      });
    }
  }

  if (show('leave')) {
    for (const b of data.leave) {
      if (b.deleted_at || b.end_date < startDate || b.start_date > endDate) continue;
      const type = leaveTypeOf(data.work, b.leave_type).name;
      const half = b.start_half || b.end_half ? ' (half day)' : '';
      out.push({
        id: `leave:${b.id}`,
        title: `${type}${b.start_date === b.end_date ? half : ''}${b.status === 'approved' || b.status === 'taken' ? '' : ` · ${b.status}`}`,
        start: b.start_date,
        end: addDays(b.end_date, 1),
        allDay: true,
        color: SOURCE_COLOURS.leave,
        editable: false,
        extendedProps: { source: 'leave', leaveId: b.id },
      });
    }
  }
  return out;
}

/**
 * Where I work on a date: Off on leave, public holidays and non-working days;
 * otherwise the day's own setting or the weekly pattern.
 */
export function locationFor(
  date: string,
  data: Pick<CalendarData, 'workDays' | 'leave' | 'work'>,
): WorkLocation {
  const onLeave = data.leave.some(
    (b) =>
      !b.deleted_at && b.start_date <= date && b.end_date >= date && !b.start_half && !b.end_half,
  );
  if (onLeave) return 'off';
  const day = data.workDays.find((w) => w.date === date && !w.deleted_at);
  if (day) return day.location;
  const holiday = holidaysBetween(date, date, data.work.manual_holidays).some(
    (h) => h.kind !== 'common',
  );
  if (holiday || data.work.closure_days.includes(date)) return 'off';
  return patternLocation(data.work, weekday(date));
}

/**
 * The item fields after a drag, resize or drop on the calendar. All-day items
 * store local midnight of the first and last day (inclusive).
 */
export function movedTimes(
  start: Date,
  end: Date | null,
  allDay: boolean,
  timeZone: string,
  defaultMinutes = 60,
): Pick<Item, 'start_at' | 'end_at' | 'all_day'> {
  if (allDay) {
    const first = localDate(start, timeZone);
    const lastExclusive = end ? localDate(end, timeZone) : addDays(first, 1);
    const last = addDays(lastExclusive, -1);
    return {
      start_at: localMidnight(first, timeZone),
      end_at: last > first ? localMidnight(last, timeZone) : null,
      all_day: true,
    };
  }
  const endAt = end ?? new Date(start.getTime() + defaultMinutes * 60_000);
  return { start_at: start.toISOString(), end_at: endAt.toISOString(), all_day: false };
}
