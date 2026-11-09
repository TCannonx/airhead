import { TZDate } from '@date-fns/tz';
import { addDays, weekday } from '../holidays/easter';
import type { Layout } from '../../app/layout';
import {
  eventForExternal,
  eventForItem,
  expandOccurrences,
  isCalendarItem,
  localDate,
  localMidnight,
  SOURCE_COLOURS,
  SOURCE_LABELS,
  type CalEvent,
  type CalendarData,
} from './sources';

/**
 * The calendar's own view logic (Task 11.3 / 11.6): periods, titles, the
 * Agenda's day groups, "when" wording and search. Pure functions over
 * YYYY-MM-DD day keys in the device's time zone, so they test without a DOM.
 */
export type CalView = 'day' | 'week' | 'month' | 'agenda';
export const CAL_VIEWS: readonly { value: CalView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' },
];

export const VIEW_KEY = 'airhead.calendar.view';
export const HIDDEN_KEY = 'airhead.calendar.hidden';
/** The Agenda shows this many days and loads the same again on scroll. */
export const AGENDA_DAYS = 30;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const pad = (n: number) => String(n).padStart(2, '0');
const parts = (key: string) => key.split('-').map(Number) as [number, number, number];

/** The view this device last used; phone defaults to Agenda, iPad and desktop to Week. */
export function readView(layout: Layout): CalView {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (CAL_VIEWS.some((v) => v.value === saved)) return saved as CalView;
  } catch {
    /* storage blocked: use the default */
  }
  return layout === 'phone' ? 'agenda' : 'week';
}

export function writeView(view: CalView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* private mode: the view just isn't remembered */
  }
}

export function readHidden(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeHidden(hidden: ReadonlySet<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    /* private mode: toggles just aren't remembered */
  }
}

/** Monday on or before a day. */
export function weekStart(key: string): string {
  return addDays(key, -((weekday(key) + 6) % 7));
}

function addMonths(key: string, n: number): string {
  const [y, m] = parts(key);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

/** The days a view shows around a day: [from, to) as YYYY-MM-DD. */
export function periodRange(
  view: CalView,
  anchor: string,
  agendaPages = 1,
): { from: string; to: string } {
  switch (view) {
    case 'day':
      return { from: anchor, to: addDays(anchor, 1) };
    case 'week': {
      const from = weekStart(anchor);
      return { from, to: addDays(from, 7) };
    }
    case 'month': {
      // The whole grid: from the Monday before the 1st, six weeks.
      const from = weekStart(`${anchor.slice(0, 7)}-01`);
      return { from, to: addDays(from, 42) };
    }
    case 'agenda':
      return { from: anchor, to: addDays(anchor, AGENDA_DAYS * agendaPages) };
  }
}

/** The day one period earlier (-1) or later (+1). */
export function shiftPeriod(view: CalView, anchor: string, dir: 1 | -1): string {
  switch (view) {
    case 'day':
      return addDays(anchor, dir);
    case 'week':
      return addDays(anchor, 7 * dir);
    case 'month':
      return addMonths(anchor, dir);
    case 'agenda':
      return addDays(anchor, AGENDA_DAYS * dir);
  }
}

/** "Thu 12 Nov 2026" (year left out with `year: false`). */
export function dayTitle(key: string, year = true): string {
  const [y, m, d] = parts(key);
  return `${WEEKDAYS[weekday(key)]} ${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
}

/** "9–15 Nov 2026", "November 2026", "Mon 9 Nov 2026". */
export function periodTitle(view: CalView, anchor: string, today: string): string {
  const [y, m] = parts(anchor);
  if (view === 'month') return `${MONTH_NAMES[m - 1]} ${y}`;
  if (view === 'day') return dayTitle(anchor);
  if (view === 'agenda') return anchor === today ? 'Next 30 days' : `From ${dayTitle(anchor)}`;
  const from = weekStart(anchor);
  const to = addDays(from, 6);
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  if (fy !== ty) return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fm !== tm) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
}

/** "Today", "Tomorrow", "Thu 12 Nov" (with the year when it isn't this year's). */
export function dayLabel(key: string, today: string): string {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return dayTitle(key, key.slice(0, 4) !== today.slice(0, 4));
}

/** "20:00" in a time zone. */
export function hm(iso: string, timeZone: string): string {
  const d = new TZDate(Date.parse(iso), timeZone);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The days an event covers, inclusive, as YYYY-MM-DD. */
export function eventDays(ev: CalEvent, timeZone: string): { first: string; last: string } {
  if (ev.allDay) {
    const first = ev.start.slice(0, 10);
    const last = ev.end ? addDays(ev.end.slice(0, 10), -1) : first;
    return { first, last: last < first ? first : last };
  }
  const first = localDate(ev.start, timeZone);
  const endMs = ev.end ? Date.parse(ev.end) : Date.parse(ev.start);
  // An end exactly at midnight belongs to the day before (20:00–00:00 is one evening).
  const last = localDate(new Date(Math.max(Date.parse(ev.start), endMs - 1)), timeZone);
  return { first, last: last < first ? first : last };
}

/** "Thu 12 Nov 2026, 20:00–00:00", "Wed 11 Nov 2026 · All day". */
export function whenText(ev: CalEvent, timeZone: string): string {
  const { first, last } = eventDays(ev, timeZone);
  if (ev.allDay) {
    return first === last
      ? `${dayTitle(first)} · All day`
      : `${dayTitle(first)} – ${dayTitle(last)} · All day`;
  }
  const start = hm(ev.start, timeZone);
  if (!ev.end) return `${dayTitle(first)}, ${start}`;
  const end = hm(ev.end, timeZone);
  return first === last
    ? `${dayTitle(first)}, ${start}–${end}`
    : `${dayTitle(first)} ${start} – ${dayTitle(last)} ${end}`;
}

export interface AgendaEntry {
  event: CalEvent;
  /** "20:00", "All day", or "Until 02:00" on a later day of a long event. */
  time: string;
  /** End time on the event's first day ("23:00"), when it has one. */
  endTime: string | null;
}

export interface AgendaDay {
  date: string;
  entries: AgendaEntry[];
}

/**
 * Events grouped by day for the Agenda, days in order, all-day events first
 * and then by start time. A long event is listed on every day it covers.
 */
export function agendaGroups(
  events: CalEvent[],
  from: string,
  to: string,
  timeZone: string,
): AgendaDay[] {
  const days = new Map<string, AgendaEntry[]>();
  for (const ev of events) {
    const { first, last } = eventDays(ev, timeZone);
    let day = first < from ? from : first;
    while (day <= last && day < to) {
      let time = 'All day';
      let endTime: string | null = null;
      if (!ev.allDay) {
        if (day === first) {
          time = hm(ev.start, timeZone);
          endTime = ev.end && first === last ? hm(ev.end, timeZone) : null;
        } else if (day === last && ev.end) time = `Until ${hm(ev.end, timeZone)}`;
      }
      const list = days.get(day) ?? [];
      list.push({ event: ev, time, endTime });
      days.set(day, list);
      day = addDays(day, 1);
    }
  }
  const rank = (e: AgendaEntry) =>
    e.event.allDay || e.time === 'All day' ? 0 : e.time.startsWith('Until') ? 1 : 2;
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, entries]) => ({
      date,
      entries: entries.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (rank(a) === 2 ? Date.parse(a.event.start) - Date.parse(b.event.start) : 0) ||
          a.event.title.localeCompare(b.event.title),
      ),
    }));
}

/** A repeat rule in words ("Every Thursday until 31 Dec"). */
export { repeatWords } from './repeat';

export interface SearchHit {
  event: CalEvent;
  past: boolean;
}

/**
 * Events whose title contains the words typed, past and future, from every
 * calendar (hidden ones too, so nothing seems lost). A repeating event is
 * listed once, at its next time (or its last one if it has ended).
 * Upcoming first (soonest first), then past (most recent first).
 */
export function searchEvents(
  data: CalendarData,
  query: string,
  now: Date,
  timeZone: string,
  limit = 50,
): { upcoming: SearchHit[]; past: SearchHit[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { upcoming: [], past: [] };
  const hits: SearchHit[] = [];
  const seriesColour = new Map(
    (data.series ?? []).filter((s) => !s.deleted_at && s.colour).map((s) => [s.id, s.colour]),
  );
  const todayStart = Date.parse(localMidnight(localDate(now, timeZone), timeZone));

  for (const item of data.items) {
    if (!isCalendarItem(item) || !item.start_at || !item.title.toLowerCase().includes(q)) continue;
    const colour = item.series_id ? seriesColour.get(item.series_id) : undefined;
    let start = item.start_at;
    let occurrence: string | undefined;
    if (item.rrule) {
      const next = expandOccurrences(
        item,
        { start: new Date(todayStart), end: new Date(todayStart + 400 * 86_400_000) },
        timeZone,
      ).find((o) => Date.parse(o) >= todayStart);
      if (next) {
        start = next;
        occurrence = next;
      }
    }
    const event = eventForItem(item, start, timeZone, occurrence, colour);
    hits.push({ event, past: Date.parse(event.end ?? event.start) < todayStart });
  }

  const feeds = new Map(data.feeds.map((f) => [f.id, f]));
  for (const e of data.external) {
    const feed = feeds.get(e.feed_id);
    if (e.deleted_at || !feed || feed.deleted_at || !feed.enabled) continue;
    if (!(e.title || '').toLowerCase().includes(q)) continue;
    const event = eventForExternal(e, feed, timeZone);
    hits.push({ event, past: Date.parse(e.end_at ?? e.start_at) < todayStart });
  }

  const at = (h: SearchHit) => Date.parse(h.event.start);
  return {
    upcoming: hits
      .filter((h) => !h.past)
      .sort((a, b) => at(a) - at(b))
      .slice(0, limit),
    past: hits
      .filter((h) => h.past)
      .sort((a, b) => at(b) - at(a))
      .slice(0, limit),
  };
}

/** The calendar an event comes from, with its colour. */
export function sourceOf(ev: CalEvent, data: CalendarData): { label: string; colour: string } {
  const s = ev.extendedProps.source;
  if (s.startsWith('feed:')) {
    const feed = data.feeds.find((f) => `feed:${f.id}` === s);
    return {
      label: feed?.name || 'Linked calendar',
      colour: feed?.colour ?? SOURCE_COLOURS.linked,
    };
  }
  const key = s as keyof typeof SOURCE_LABELS;
  return { label: SOURCE_LABELS[key], colour: SOURCE_COLOURS[key] };
}

/** An event's location, if it has one. */
export function locationOf(ev: CalEvent, data: CalendarData): string | null {
  const { itemId, externalId } = ev.extendedProps;
  if (itemId) {
    const loc = data.items.find((i) => i.id === itemId)?.data.location;
    return typeof loc === 'string' && loc ? loc : null;
  }
  if (externalId) return data.external.find((e) => e.id === externalId)?.location || null;
  return null;
}

/** Every calendar a person can show or hide: built-in ones, then linked calendars. */
export function calendarSources(
  data: CalendarData | undefined,
): { key: string; label: string; colour: string }[] {
  return [
    ...(['personal', 'us', 'tasks', 'holidays', 'leave'] as const).map((k) => ({
      key: k,
      label: SOURCE_LABELS[k],
      colour: SOURCE_COLOURS[k],
    })),
    ...(data?.feeds ?? [])
      .filter((f) => f.kind === 'linked_in' && !f.deleted_at)
      .map((f) => ({
        key: `feed:${f.id}`,
        label: f.name || 'Linked calendar',
        colour: f.colour ?? SOURCE_COLOURS.linked,
      })),
  ];
}
