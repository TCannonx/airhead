import { addDays, weekday } from '../_shared/holidays/easter.ts';
import { holidaysBetween } from '../_shared/holidays/ie.ts';
import { buildCalendar, type IcsEvent } from '../_shared/ics.ts';

/**
 * Builds a published calendar feed (Task 4.8). Pure: the handler loads rows and
 * passes them in.
 *
 * - us_out: Us events, leave marked "share to Us" as all-day "Off", and each
 *   working day's location per the sharing setting (or nothing).
 * - me_out: everything for my own phone (Personal and Us events, time-blocked
 *   tasks, all leave, locations).
 */
export type FeedKind = 'us_out' | 'me_out';
type Location = 'wfh' | 'office' | 'client' | 'travel' | 'off';

export interface FeedItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  status: string;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  rrule: string | null;
  calendar: string | null;
  updated_at: string;
  deleted_at: string | null;
}
export interface FeedLeave {
  id: string;
  start_date: string;
  end_date: string;
  start_half: boolean;
  end_half: boolean;
  leave_type: string;
  status: string;
  share_us: boolean;
  updated_at: string;
  deleted_at: string | null;
}
export interface FeedWorkDay {
  date: string;
  location: Location;
  deleted_at: string | null;
}

export interface FeedInput {
  kind: FeedKind;
  userId: string;
  /** settings.data of the owner. */
  settings: Record<string, unknown>;
  items: FeedItem[];
  leave: FeedLeave[];
  workDays: FeedWorkDay[];
  now: Date;
}

const LABELS: Record<Location, string> = {
  wfh: 'WFH',
  office: 'Office',
  client: 'Client site',
  travel: 'Travel',
  off: 'Off',
};
const DEFAULT_PATTERN: Record<string, Location> = {
  '1': 'office',
  '2': 'office',
  '3': 'wfh',
  '4': 'office',
  '5': 'wfh',
};

interface Work {
  working_days: number[];
  location_pattern: Record<string, Location>;
  manual_holidays: { date: string; name: string }[];
  closure_days: string[];
  location_sharing: 'full' | 'working' | 'none';
  leave_types: { key: string; name: string }[];
}

/** The app's work settings with the same defaults (src/lib/work/settings.ts). */
export function readWork(settings: Record<string, unknown>): Work {
  const w = (settings.work ?? {}) as Partial<Work>;
  const arr = <T>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d);
  return {
    working_days: arr(w.working_days, [1, 2, 3, 4, 5]),
    location_pattern:
      w.location_pattern && typeof w.location_pattern === 'object'
        ? w.location_pattern
        : DEFAULT_PATTERN,
    manual_holidays: arr(w.manual_holidays, []),
    closure_days: arr(w.closure_days, []),
    location_sharing: ['full', 'working', 'none'].includes(w.location_sharing as string)
      ? (w.location_sharing as Work['location_sharing'])
      : 'full',
    leave_types: arr(w.leave_types, [
      { key: 'annual', name: 'Annual leave' },
      { key: 'sick', name: 'Sick leave' },
    ]),
  };
}

/** Local wall-clock parts of an instant in a time zone. */
function localParts(iso: string, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    stamp: `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`,
  };
}

export function locationFor(
  date: string,
  work: Work,
  leave: FeedLeave[],
  workDays: FeedWorkDay[],
): Location {
  if (leave.some((b) => b.start_date <= date && b.end_date >= date && !b.start_half && !b.end_half))
    return 'off';
  const day = workDays.find((w) => w.date === date);
  if (day) return day.location;
  if (
    holidaysBetween(date, date, work.manual_holidays).some((h) => h.kind !== 'common') ||
    work.closure_days.includes(date)
  )
    return 'off';
  if (!work.working_days.includes(weekday(date))) return 'off';
  return work.location_pattern[String(weekday(date))] ?? 'office';
}

function itemEvent(item: FeedItem, tz: string, withNotes: boolean): IcsEvent | null {
  if (!item.start_at) return null;
  const base = {
    uid: `${item.id}@airhead`,
    stamp: item.updated_at,
    summary: item.type === 'task' ? `Task: ${item.title}` : item.title,
    location: typeof item.data.location === 'string' ? item.data.location : null,
    description: withNotes ? item.body : null,
    rrule: item.rrule,
  };
  if (item.all_day) {
    const first = localParts(item.start_at, tz).date;
    const last = item.end_at ? localParts(item.end_at, tz).date : first;
    return { ...base, allDay: true, start: first, end: addDays(last < first ? first : last, 1) };
  }
  const end = item.end_at ?? new Date(Date.parse(item.start_at) + 3_600_000).toISOString();
  return {
    ...base,
    allDay: false,
    start: item.start_at,
    end,
    // Recurring events keep their wall-clock time across the clock change.
    ...(item.rrule
      ? {
          tzid: tz,
          localStart: localParts(item.start_at, tz).stamp,
          localEnd: localParts(end, tz).stamp,
        }
      : {}),
  };
}

function leaveEvent(b: FeedLeave, kind: FeedKind, work: Work): IcsEvent {
  const typeName = work.leave_types.find((t) => t.key === b.leave_type)?.name ?? 'Leave';
  const half =
    b.start_date === b.end_date && (b.start_half || b.end_half)
      ? b.start_half
        ? ' (afternoon)'
        : ' (morning)'
      : '';
  return {
    uid: `leave-${b.id}@airhead`,
    stamp: b.updated_at,
    summary: kind === 'us_out' ? `Off${half}` : `${typeName}${half} · ${b.status}`,
    allDay: true,
    start: b.start_date,
    end: addDays(b.end_date, 1),
    transparent: kind === 'us_out' ? false : true,
  };
}

/** The iCalendar text for a feed. Window for locations: 14 days back, 120 ahead. */
export function buildFeed(input: FeedInput): string {
  const tz =
    typeof input.settings.time_zone === 'string' ? input.settings.time_zone : 'Europe/Dublin';
  const work = readWork(input.settings);
  const live = <T extends { deleted_at: string | null }>(rows: T[]) =>
    rows.filter((r) => !r.deleted_at);
  const items = live(input.items);
  const leave = live(input.leave);
  const workDays = live(input.workDays);
  const events: IcsEvent[] = [];

  for (const item of items) {
    const isEvent = item.type === 'event' && item.status === 'open';
    const isBlock = item.type === 'task' && (item.status === 'open' || item.status === 'done');
    if (input.kind === 'us_out' ? !(isEvent && item.calendar === 'us') : !(isEvent || isBlock))
      continue;
    const e = itemEvent(item, tz, input.kind === 'me_out');
    if (e) events.push(e);
  }

  for (const b of leave) {
    if (input.kind === 'us_out' && !b.share_us) continue;
    events.push(leaveEvent(b, input.kind, work));
  }

  const sharing = input.kind === 'me_out' ? 'full' : work.location_sharing;
  if (sharing !== 'none') {
    const today = localParts(input.now.toISOString(), tz).date;
    for (let d = addDays(today, -14); d <= addDays(today, 120); d = addDays(d, 1)) {
      const loc = locationFor(d, work, leave, workDays);
      if (loc === 'off') continue;
      events.push({
        uid: `loc-${input.userId.slice(0, 8)}-${d}@airhead`,
        stamp: input.now.toISOString(),
        summary: sharing === 'working' ? 'Working' : LABELS[loc],
        allDay: true,
        start: d,
        end: addDays(d, 1),
        transparent: true,
      });
    }
  }

  return buildCalendar(input.kind === 'us_out' ? 'Us (Airhead)' : 'Airhead', events);
}
