import { addDays } from '../holidays/easter';
import { analyseCapture } from '../rules';
import { newItem } from '../db/repository';
import type { Item } from '../schemas/records';
import { eventForItem, localDate, localMidnight } from './sources';
import { repeatWords } from './repeat';
import { whenText } from './view';

/**
 * Quick add (Task 11.4): typed text such as "Quiz every Thursday 8pm-12pm",
 * "Dentist Fri 3pm" or "Niamh's birthday 11/11 every year" read by the same
 * free rules as Capture (`analyseCapture`), ready to preview and save.
 */
export interface QuickEvent {
  title: string;
  /** ISO instant; all-day: local midnight of the first day. */
  start: string;
  /** Timed: the end (an hour after the start when none was said). All-day: last day's midnight or null. */
  end: string | null;
  allDay: boolean;
  rrule: string | null;
  calendar: 'personal' | 'us';
  /** False when the text had no date or time, so the default slot was used. */
  dated: boolean;
}

export interface QuickPreview {
  title: string;
  when: string;
  repeat: string | null;
  calendar: string;
}

const HOUR = 3_600_000;

/** The default slot on a day: the next whole hour today, else 09:00. */
export function defaultSlot(day: string, now: Date, timeZone: string): Date {
  if (day === localDate(now, timeZone)) {
    const next = new Date(now.getTime());
    next.setMinutes(0, 0, 0);
    return new Date(next.getTime() + HOUR);
  }
  return new Date(Date.parse(localMidnight(day, timeZone)) + 9 * HOUR);
}

export function parseQuickAdd(
  text: string,
  { now = new Date(), timeZone, day }: { now?: Date; timeZone: string; day?: string },
): QuickEvent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const a = analyseCapture(trimmed, { now, timeZone });
  const title = a.title || '';
  if (!a.when) {
    const start = defaultSlot(day ?? localDate(now, timeZone), now, timeZone);
    return {
      title: title || trimmed,
      start: start.toISOString(),
      end: new Date(start.getTime() + HOUR).toISOString(),
      allDay: false,
      rrule: null,
      calendar: 'personal',
      dated: false,
    };
  }
  const { start, end, allDay, rrule } = a.when;
  return {
    title,
    start,
    end: allDay ? end : (end ?? new Date(Date.parse(start) + HOUR).toISOString()),
    allDay,
    rrule,
    calendar: 'personal',
    dated: true,
  };
}

/** The item quick add saves. */
export function quickItem(userId: string, q: QuickEvent): Item {
  return newItem(userId, {
    type: 'event',
    title: q.title,
    status: 'open',
    calendar: q.calendar,
    start_at: q.start,
    end_at: q.end,
    all_day: q.allDay,
    rrule: q.rrule,
  });
}

/** What the preview shows: "Quiz", "Thu 12 Nov 2026, 20:00–00:00", "Every Thursday", "Personal". */
export function quickPreview(q: QuickEvent, timeZone: string, now = new Date()): QuickPreview {
  const ev = eventForItem(quickItem('preview', q), q.start, timeZone);
  const first = localDate(q.start, timeZone);
  return {
    title: q.title || '(no title)',
    when: whenText(ev, timeZone),
    repeat: q.rrule ? repeatWords(q.rrule, first, localDate(now, timeZone)) : null,
    calendar: q.calendar === 'us' ? 'Us (shared)' : 'Personal',
  };
}

/** The editor's draft times for a quick-add event (all-day ends are exclusive there). */
export function quickDraftTimes(q: QuickEvent, timeZone: string) {
  if (!q.allDay) return { start: new Date(q.start), end: q.end ? new Date(q.end) : null };
  const last = q.end ? localDate(q.end, timeZone) : localDate(q.start, timeZone);
  return { start: new Date(q.start), end: new Date(localMidnight(addDays(last, 1), timeZone)) };
}
