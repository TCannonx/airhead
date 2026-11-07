import { expandOccurrences, localDate, type CalendarData } from '../calendar/sources';
import { isLeaveDay } from '../leave/engine';
import type { ProposedEvent } from './types';

/**
 * Review-table checks (Task 4.10): clashes with what's already on the
 * calendar, and events on working days (which can become a leave booking).
 */
export interface EventChecks {
  /** Titles of existing things at the same time (or the same day, for untimed ones). */
  clashes: string[];
  /** The event falls on a working day that would cost leave. */
  workingDay: boolean;
}

interface Busy {
  title: string;
  date: string;
  /** Minutes from midnight; null for all-day. */
  from: number | null;
  to: number | null;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function localMinutes(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Existing timed and all-day entries between two dates, per day. */
export function busyBetween(data: CalendarData, from: string, to: string, tz: string): Busy[] {
  const range = {
    start: new Date(`${from}T00:00:00Z`),
    end: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000),
  };
  const out: Busy[] = [];
  const push = (title: string, startIso: string, endIso: string | null, allDay: boolean) => {
    const date = localDate(startIso, tz);
    if (date < from || date > to) return;
    if (allDay) out.push({ title, date, from: null, to: null });
    else {
      const s = localMinutes(startIso, tz);
      const e = endIso ? localMinutes(endIso, tz) : s + 60;
      out.push({ title, date, from: s, to: e > s ? e : s + 60 });
    }
  };
  for (const i of data.items) {
    if (i.deleted_at || !i.start_at || i.type !== 'event' || i.status !== 'open') continue;
    const duration = i.end_at ? Date.parse(i.end_at) - Date.parse(i.start_at) : null;
    const starts = i.rrule ? expandOccurrences(i, range, tz) : [i.start_at];
    for (const s of starts) {
      push(
        i.title,
        s,
        duration !== null ? new Date(Date.parse(s) + duration).toISOString() : null,
        i.all_day,
      );
    }
  }
  for (const e of data.external) {
    if (!e.deleted_at) push(e.title, e.start_at, e.end_at, e.all_day);
  }
  return out;
}

export function checkEvent(e: ProposedEvent, busy: Busy[], data: CalendarData): EventChecks {
  const sameDay = busy.filter((b) => b.date === e.date);
  let clashes: Busy[];
  if (!e.start_time) {
    // An untimed (TBC) event only clashes with other all-day plans that day.
    clashes = sameDay.filter((b) => b.from === null);
  } else {
    const s = minutes(e.start_time);
    const end = e.end_time ? minutes(e.end_time) : s + 120;
    clashes = sameDay.filter((b) => b.from !== null && b.to !== null && b.from < end && s < b.to);
  }
  const workingDay = isLeaveDay(e.date, data.work);
  return { clashes: [...new Set(clashes.map((c) => c.title))], workingDay };
}
