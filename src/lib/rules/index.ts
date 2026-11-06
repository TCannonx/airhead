import { TZDate } from '@date-fns/tz';
import * as chrono from 'chrono-node';
import { findUrl } from './links';
import { parseRecurrence, toRRule, WEEKDAY_INDEX, type Recurrence, type Span } from './recurrence';

export const DEFAULT_TIME_ZONE = 'Europe/Dublin';

export interface When {
  /** ISO instant. For all-day items: local midnight of the (first) day. */
  start: string;
  /** All-day ranges: local midnight of the LAST day (inclusive). Timed: null for now. */
  end: string | null;
  allDay: boolean;
  rrule: string | null;
  /** Clear, future, unambiguous: safe to create an event automatically. */
  confident: boolean;
}

export interface Analysis {
  kind: 'text' | 'link';
  url: string | null;
  /** Text without the date, recurrence and link parts, tidied and capitalised. */
  title: string;
  when: When | null;
}

const FUZZY =
  /\b(?:sometime|some\s+time|maybe|possibly|probably|perhaps|around|roughly|approx(?:imately)?|at\s+some\s+point|soon|tbc|tbd|or\s+so)\b|\d(?::\d\d)?\s*(?:am|pm)?ish\b|-ish\b/i;
const VAGUE_PERIOD = /\b(?:next|this)\s+(?:week|month)\b/i;
const WEEKDAY_WORD = /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i;
const ALL_DAY_WORDS =
  /\b(?:all[\s-]day|birthday|b'?day|anniversary|holidays?|day\s+off|bank\s+holiday)\b/i;
const YEARLY_WORDS = /\b(?:birthday|b'?day|anniversary)\b/i;
const ISH_TIME = /\b\d{1,2}(?::\d\d)?\s*(?:am|pm)?ish\b/gi;
/** Hedge words are a signal for the confidence rule, not part of the title. */
const HEDGES = /^(?:sometime|maybe|possibly|probably|perhaps)$/i;
const CONNECTORS = /^(?:at|on|by|from|for|every|each|the|and|in)$/i;

const blank = (text: string, spans: Span[]) => {
  const chars = [...text];
  for (const [s, e] of spans) for (let i = s; i < e && i < chars.length; i++) chars[i] = ' ';
  return chars.join('');
};

function tidyTitle(text: string, spans: Span[]): string {
  const words = blank(text, spans)
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !HEDGES.test(w));
  while (words.length && CONNECTORS.test(words[0] ?? '')) words.shift();
  while (words.length && CONNECTORS.test(words[words.length - 1] ?? '')) words.pop();
  const title = words.join(' ').replace(/[\s,;:-]+$/, '');
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
}

/** Local calendar parts of an instant in the time zone. */
function localParts(date: Date, tz: string) {
  const d = new TZDate(date, tz);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), dow: d.getDay() };
}

const at = (tz: string, y: number, m: number, d: number, h = 0, min = 0) =>
  new TZDate(y, m, d, h, min, 0, tz);

/** First date on/after today (local) matching the rule, at the given time, in the future. */
function firstOccurrence(
  rec: Recurrence,
  now: Date,
  tz: string,
  time: { h: number; m: number } | null,
  chronoStart: Date | null,
): Date {
  const today = localParts(now, tz);
  for (let offset = 0; offset < 400; offset++) {
    const day = at(tz, today.y, today.m, today.d + offset);
    const p = localParts(day, tz);
    let matches: boolean;
    if (rec.byDay.length) matches = rec.byDay.some((wd) => WEEKDAY_INDEX[wd] === p.dow);
    else if (rec.byMonthDay) matches = p.d === rec.byMonthDay;
    else if (chronoStart && rec.freq !== 'DAILY') {
      const c = localParts(chronoStart, tz);
      matches = c.y === p.y && c.m === p.m && c.d === p.d;
    } else matches = true;
    if (!matches) continue;
    const candidate = time ? at(tz, p.y, p.m, p.d, time.h, time.m) : at(tz, p.y, p.m, p.d);
    if (!time || candidate.getTime() > now.getTime()) return candidate;
  }
  return at(tz, today.y, today.m, today.d);
}

/**
 * Free, on-device rules run instantly on every capture: link detection,
 * British-English date parsing ("3/4" = 3 April), recurrence and confidence.
 * The original text is never changed.
 */
export function analyseCapture(
  text: string,
  { now = new Date(), timeZone = DEFAULT_TIME_ZONE }: { now?: Date; timeZone?: string } = {},
): Analysis {
  const spans: Span[] = [];
  const link = findUrl(text);
  if (link) spans.push([link.index, link.index + link.length]);

  // "8ish" style times are fuzzy: hide them from the parser (same length, so
  // positions still line up) and from the title.
  const ishSpans: Span[] = [...text.matchAll(ISH_TIME)].map((m) => [
    m.index ?? 0,
    (m.index ?? 0) + m[0].length,
  ]);
  spans.push(...ishSpans);
  const forParser = blank(text, [...spans]);

  const rec = parseRecurrence(forParser);
  if (rec) spans.push(...rec.spans);

  // The recurrence already says which days; hide its words from the date
  // parser so "every 2 weeks" isn't read as "in 2 weeks". It then only has to
  // find a time (and a date for yearly/weekly-from-a-date rules).
  const results = chrono.en.GB.parse(
    rec ? blank(forParser, rec.spans) : forParser,
    { instant: now, timezone: timeZone },
    { forwardDate: true },
  );
  const result = results[0] ?? null;
  if (result) spans.push([result.index, result.index + result.text.length]);
  // "4/3 dentist at 9am": the date and the time come back as two results.
  const timeOnly =
    result && !result.start.isCertain('hour')
      ? results.find(
          (r) =>
            r !== result &&
            r.start.isCertain('hour') &&
            !r.start.isCertain('day') &&
            !r.start.isCertain('weekday'),
        )
      : undefined;
  if (timeOnly) spans.push([timeOnly.index, timeOnly.index + timeOnly.text.length]);

  const title = tidyTitle(text, spans) || (link ? link.url : '');
  const base = {
    kind: link ? ('link' as const) : ('text' as const),
    url: link?.url ?? null,
    title,
  };

  const fuzzy = FUZZY.test(text) || (VAGUE_PERIOD.test(text) && !WEEKDAY_WORD.test(text));
  const allDayWording = ALL_DAY_WORDS.test(text);

  if (!result && !rec) return { ...base, when: null };

  const timeSource = result?.start.isCertain('hour') ? result : timeOnly;
  const hasTime = !!timeSource;
  const time = timeSource
    ? { h: timeSource.start.get('hour') ?? 0, m: timeSource.start.get('minute') ?? 0 }
    : null;
  const chronoStart = result?.start.date() ?? null;

  let start: Date;
  let end: Date | null = null;
  let rrule: string | null = null;
  let hasDate: boolean;

  if (rec && (rec.byDay.length || rec.byMonthDay || rec.freq === 'DAILY' || !chronoStart)) {
    start = firstOccurrence(rec, now, timeZone, time, chronoStart);
    rrule = toRRule(rec);
    hasDate = true;
  } else {
    if (!chronoStart || !result) return { ...base, when: null };
    hasDate =
      result.start.isCertain('day') ||
      result.start.isCertain('weekday') ||
      result.start.isCertain('month');
    const s = localParts(chronoStart, timeZone);
    start = time ? at(timeZone, s.y, s.m, s.d, time.h, time.m) : at(timeZone, s.y, s.m, s.d);
    if (result.end && !time) {
      const e = localParts(result.end.date(), timeZone);
      end = at(timeZone, e.y, e.m, e.d);
    }
    if (rec) rrule = toRRule(rec);
    else if (YEARLY_WORDS.test(text) && !time) rrule = 'FREQ=YEARLY';
  }

  const allDay = !time;
  const future = allDay
    ? start.getTime() >=
      at(
        timeZone,
        localParts(now, timeZone).y,
        localParts(now, timeZone).m,
        localParts(now, timeZone).d,
      ).getTime()
    : start.getTime() > now.getTime();
  const confident = hasDate && (hasTime || allDayWording) && future && !fuzzy;

  return {
    ...base,
    when: {
      // Always plain UTC (TZDate's own toISOString writes the zone offset).
      start: new Date(start.getTime()).toISOString(),
      end: end ? new Date(end.getTime()).toISOString() : null,
      allDay,
      rrule,
      confident,
    },
  };
}
