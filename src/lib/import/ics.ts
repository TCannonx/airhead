import { TZDate } from '@date-fns/tz';
import ICAL from 'ical.js';
import { byWhen, proposed, type ProposedEvent } from './types';

/**
 * .ics files (Task 4.10): parsed exactly on the device. Recurring events are
 * expanded for a year; cancelled ones are left out. Only future events (from
 * today) are proposed.
 */
const pad = (n: number) => String(n).padStart(2, '0');

function local(t: ICAL.Time, tz: string): { date: string; time: string | null } {
  if (t.isDate) return { date: `${t.year}-${pad(t.month)}-${pad(t.day)}`, time: null };
  const d = new TZDate(t.toJSDate().getTime(), tz);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function isIcs(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text.replace(/^\uFEFF/, ''));
}

export function parseIcsImport(
  text: string,
  now: Date,
  tz: string,
): {
  name: string | null;
  events: ProposedEvent[];
} {
  const root = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')));
  for (const z of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(z);
  const today = local(ICAL.Time.fromJSDate(now, true), tz).date;
  const until = now.getTime() + 366 * 86_400_000;
  const out: ProposedEvent[] = [];

  const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED')
      return;
    const s = local(start, tz);
    if (s.date < today) return;
    let endDate: string | null = null;
    let endTime: string | null = null;
    if (end) {
      if (start.isDate) {
        const last = end.clone();
        last.adjust(-1, 0, 0, 0);
        const l = local(last, tz).date;
        endDate = l > s.date ? l : null;
      } else {
        const e = local(end, tz);
        endTime = e.time;
        endDate = e.date > s.date ? e.date : null;
      }
    }
    out.push(
      proposed({
        title: (item.summary || '').trim() || 'Event',
        date: s.date,
        start_time: s.time,
        end_time: endTime,
        end_date: endDate,
        venue: item.location?.trim() || null,
        notes: item.description?.trim().slice(0, 500) || null,
      }),
    );
  };

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const v of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v);
    if (e.isRecurrenceException()) exceptions.push(e);
    else masters.set(e.uid || `${masters.size}`, e);
  }
  for (const ex of exceptions) masters.get(ex.uid)?.relateException(ex);
  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate ?? null);
      continue;
    }
    const it = event.iterator();
    let n = 0;
    for (let t = it.next(); t && n < 500; t = it.next(), n++) {
      if (t.toJSDate().getTime() > until) break;
      const d = event.getOccurrenceDetails(t);
      add(d.item, d.startDate, d.endDate ?? null);
    }
  }
  const name = root.getFirstPropertyValue('x-wr-calname');
  return { name: typeof name === 'string' ? name : null, events: out.sort(byWhen) };
}
