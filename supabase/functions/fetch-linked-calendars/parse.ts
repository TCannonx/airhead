import ICAL from 'npm:ical.js@2.2.1';

/**
 * Parses a linked calendar's iCalendar text into occurrences (Task 4.9).
 * Recurrences are expanded from 30 days back to 12 months ahead, with moved
 * instances (RECURRENCE-ID) and EXDATEs applied; cancelled events are left out.
 * The calendar is data only: nothing in it is ever acted on.
 */
export interface Occurrence {
  /** UID plus the original start for recurring events: stable across fetches. */
  occurrence_key: string;
  title: string;
  location: string | null;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
}

export interface ParsedCalendar {
  name: string | null;
  occurrences: Occurrence[];
}

export const PAST_DAYS = 30;
export const AHEAD_DAYS = 366;
/** A runaway rule (e.g. every minute) can't flood the table. */
export const MAX_PER_EVENT = 800;
const MAX_TEXT = 2000;

const clip = (s: unknown) =>
  typeof s === 'string' && s.trim() ? s.trim().slice(0, MAX_TEXT) : null;

/**
 * All-day dates are stored at 12:00 UTC so the date reads the same in any time
 * zone within ±11 hours (the device takes the local date of the instant).
 */
function instant(t: ICAL.Time): string {
  if (t.isDate) {
    const d = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return `${d}T12:00:00.000Z`;
  }
  return t.toJSDate().toISOString();
}

export function isCalendarText(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text.replace(/^﻿/, ''));
}

export function parseCalendar(text: string, now: Date): ParsedCalendar {
  const root = new ICAL.Component(ICAL.parse(text.replace(/^﻿/, '')));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(tz);
  }
  const from = now.getTime() - PAST_DAYS * 86_400_000;
  const to = now.getTime() + AHEAD_DAYS * 86_400_000;
  const vevents = root.getAllSubcomponents('vevent');

  // Group by UID: the master (with RRULE) and its moved instances.
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of vevents) {
    const e = new ICAL.Event(v);
    if (!e.uid) continue;
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid, e);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);

  const out: Occurrence[] = [];
  const cancelled = (c: ICAL.Component) =>
    String(c.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
  const push = (key: string, item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    if (cancelled(item.component)) return;
    const s = Date.parse(instant(start));
    const e = end ? Date.parse(instant(end)) : s;
    if (e < from || s > to) return;
    out.push({
      occurrence_key: key,
      title: clip(item.summary) ?? '(busy)',
      location: clip(item.location),
      description: clip(item.description),
      start_at: instant(start),
      end_at: end ? instant(end) : null,
      all_day: start.isDate,
    });
  };

  for (const [uid, event] of masters) {
    if (!event.isRecurring()) {
      push(uid, event, event.startDate, event.endDate ?? null);
      continue;
    }
    const it = event.iterator();
    let n = 0;
    for (let next = it.next(); next && n < MAX_PER_EVENT; next = it.next(), n++) {
      if (next.toJSDate().getTime() > to) break;
      const d = event.getOccurrenceDetails(next);
      push(`${uid}|${next.toString()}`, d.item, d.startDate, d.endDate ?? null);
    }
  }

  const name = root.getFirstPropertyValue('x-wr-calname');
  return { name: typeof name === 'string' ? name : null, occurrences: out };
}
