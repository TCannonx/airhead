import { RRule } from 'rrule';
import { weekday } from '../holidays/easter';
import type { Weekday } from '../rules/recurrence';

/**
 * Repeat rules for the event form (Task 11.4) and in words (Tasks 11.4, 11.5).
 * Rules are RRULE text without DTSTART: the item's start is the first
 * occurrence. UNTIL is written as the end of a local day in "floating" time
 * (`YYYYMMDDT235959Z`), the same wall-clock encoding the calendar and the
 * reminder job use to expand rules, so "until 31 Dec" means the whole of
 * 31 December wherever the person is.
 */
export type Freq = '' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type Ends = 'never' | 'on' | 'after';

export interface RepeatForm {
  freq: Freq;
  interval: number;
  /** Weekly: the days it happens on. */
  byDay: Weekday[];
  ends: Ends;
  /** Ends 'on': the last day, YYYY-MM-DD (inclusive). */
  until: string;
  /** Ends 'after': how many times in all. */
  count: number;
  /** Parts the form does not edit (BYMONTHDAY, BYSETPOS…), kept as they are. */
  extra: string[];
}

export const WEEKDAYS: readonly { code: Weekday; short: string; long: string }[] = [
  { code: 'MO', short: 'Mon', long: 'Monday' },
  { code: 'TU', short: 'Tue', long: 'Tuesday' },
  { code: 'WE', short: 'Wed', long: 'Wednesday' },
  { code: 'TH', short: 'Thu', long: 'Thursday' },
  { code: 'FR', short: 'Fri', long: 'Friday' },
  { code: 'SA', short: 'Sat', long: 'Saturday' },
  { code: 'SU', short: 'Sun', long: 'Sunday' },
];
/** Index by JavaScript's getDay() (0 = Sunday). */
const BY_JS_DAY: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HANDLED = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT']);
const FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

/** The weekday code of a YYYY-MM-DD day. */
export const weekdayOf = (day: string): Weekday => BY_JS_DAY[weekday(day)] ?? 'MO';

const strip = (rrule: string) => rrule.replace(/^RRULE:/i, '').trim();

/** The rule's parts as a map (keys upper case). */
export function ruleParts(rrule: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of strip(rrule).split(';')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) map.set(k.trim().toUpperCase(), v.trim());
  }
  return map;
}

/** 20261231T235959Z or 20261231 → 2026-12-31. */
export const untilDay = (value: string) =>
  `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
/** 2026-12-31 → 20261231T235959Z (the end of that local day, floating). */
export const untilValue = (day: string) => `${day.replace(/-/g, '')}T235959Z`;

/** True when the form can show and edit the rule without losing anything it means. */
export function formCanEdit(rrule: string | null | undefined): boolean {
  if (!rrule) return true;
  return FREQS.has(ruleParts(rrule).get('FREQ') ?? '');
}

/** A rule as the form shows it. `start` (YYYY-MM-DD) fills a weekly rule's day. */
export function readRepeat(rrule: string | null | undefined, start?: string): RepeatForm {
  const form: RepeatForm = {
    freq: '',
    interval: 1,
    byDay: [],
    ends: 'never',
    until: start ?? '',
    count: 10,
    extra: [],
  };
  if (!rrule) return form;
  const parts = ruleParts(rrule);
  const freq = parts.get('FREQ') ?? '';
  if (!FREQS.has(freq)) return form;
  form.freq = freq as Freq;
  form.interval = Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1);
  form.byDay = (parts.get('BYDAY') ?? '')
    .split(',')
    .map((d) => d.trim().toUpperCase())
    .filter((d): d is Weekday => WEEKDAYS.some((w) => w.code === d));
  if (form.freq === 'WEEKLY' && form.byDay.length === 0 && start) form.byDay = [weekdayOf(start)];
  const until = parts.get('UNTIL');
  const count = parts.get('COUNT');
  if (until) {
    form.ends = 'on';
    form.until = untilDay(until);
  } else if (count) {
    form.ends = 'after';
    form.count = Math.max(1, Number(count) || 1);
  }
  form.extra = [...parts.entries()].filter(([k]) => !HANDLED.has(k)).map(([k, v]) => `${k}=${v}`);
  return form;
}

/** The RRULE for a form, or null when it does not repeat. */
export function buildRepeat(form: RepeatForm): string | null {
  if (!form.freq) return null;
  const order = WEEKDAYS.map((w) => w.code);
  const parts = [`FREQ=${form.freq}`];
  if (form.interval > 1) parts.push(`INTERVAL=${Math.floor(form.interval)}`);
  if (form.freq === 'WEEKLY' && form.byDay.length)
    parts.push(
      `BYDAY=${[...new Set(form.byDay)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(',')}`,
    );
  // Weekly days only mean something on a weekly rule.
  parts.push(...form.extra.filter((p) => form.freq === 'WEEKLY' || !p.startsWith('BYDAY')));
  if (form.ends === 'on' && /^\d{4}-\d{2}-\d{2}$/.test(form.until))
    parts.push(`UNTIL=${untilValue(form.until)}`);
  if (form.ends === 'after') parts.push(`COUNT=${Math.max(1, Math.floor(form.count) || 1)}`);
  return parts.join(';');
}

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

const list = (words: string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** "31 Dec" (with the year when it is not this year). */
function shortDate(day: string, thisYear: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}${String(y) === thisYear ? '' : ` ${y}`}`;
}

/**
 * A rule in plain British English: "Every Thursday", "Every 2 weeks on Mon and
 * Thu", "Every weekday", "Every month on the 1st", "Every year on 11 Nov",
 * "Every Thursday until 31 Dec", "Every day, 5 times". `start` (YYYY-MM-DD,
 * the first occurrence's local day) fills in the day where the rule leaves it
 * to the start. Rules it cannot word fall back to rrule's own English.
 */
export function repeatWords(
  rrule: string,
  start?: string | null,
  today: string = new Date().toISOString().slice(0, 10),
): string {
  const parts = ruleParts(rrule);
  const freq = parts.get('FREQ') ?? '';
  const known = [...parts.keys()].every((k) => HANDLED.has(k) || k === 'BYMONTHDAY');
  const days = (parts.get('BYDAY') ?? '').split(',').filter(Boolean);
  const plainDays = days.every((d) => WEEKDAYS.some((w) => w.code === d));
  if (!FREQS.has(freq) || !known || !plainDays || (days.length && freq !== 'WEEKLY')) {
    return fallback(rrule);
  }
  const n = Math.max(1, Number(parts.get('INTERVAL') ?? 1) || 1);
  const monthDay = Number(parts.get('BYMONTHDAY') ?? 0) || null;
  let text: string;
  switch (freq) {
    case 'DAILY':
      text = n === 1 ? 'Every day' : `Every ${n} days`;
      break;
    case 'WEEKLY': {
      const codes = days.length ? days : start ? [weekdayOf(start)] : [];
      const isWeekdays =
        codes.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((c) => codes.includes(c));
      const named = WEEKDAYS.filter((w) => codes.includes(w.code));
      if (n === 1) {
        if (isWeekdays) text = 'Every weekday';
        else if (named.length === 1) text = `Every ${named[0]?.long}`;
        else if (named.length) text = `Every ${list(named.map((w) => w.short))}`;
        else text = 'Every week';
      } else {
        text = named.length
          ? `Every ${n} weeks on ${named.length === 1 ? named[0]?.long : list(named.map((w) => w.short))}`
          : `Every ${n} weeks`;
      }
      break;
    }
    case 'MONTHLY': {
      const day = monthDay ?? (start ? Number(start.slice(8, 10)) : null);
      text = `${n === 1 ? 'Every month' : `Every ${n} months`}${day ? ` on the ${ordinal(day)}` : ''}`;
      break;
    }
    default: {
      const base = n === 1 ? 'Every year' : `Every ${n} years`;
      text = start ? `${base} on ${shortDate(start, start.slice(0, 4))}` : base;
    }
  }
  const until = parts.get('UNTIL');
  const count = Number(parts.get('COUNT') ?? 0);
  if (until) text += ` until ${shortDate(untilDay(until), today.slice(0, 4))}`;
  else if (count) text += count === 1 ? ', once' : `, ${count} times`;
  return text;
}

function fallback(rrule: string): string {
  let text: string;
  try {
    text = RRule.fromString(strip(rrule)).toText();
  } catch {
    text = rrule;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
