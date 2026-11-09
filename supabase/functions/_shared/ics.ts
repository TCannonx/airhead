/**
 * A small RFC 5545 iCalendar writer (Task 4.8): enough for subscribed feeds in
 * Apple and Google Calendar. Lines end with CRLF and are folded at 75 octets;
 * text values are escaped.
 */
export interface IcsEvent {
  uid: string;
  /** Last change (DTSTAMP / LAST-MODIFIED), ISO instant. */
  stamp: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  /** All-day: YYYY-MM-DD (end exclusive). Timed: ISO instants. */
  allDay: boolean;
  start: string;
  end?: string | null;
  /** Timed recurring events: wall-clock start in `tzid`, e.g. 20261013T190000. */
  localStart?: string;
  localEnd?: string;
  tzid?: string;
  rrule?: string | null;
  /**
   * Exceptions of a recurring event, already in the start's form: YYYYMMDD
   * (all-day), a wall-clock stamp in `tzid`, or a UTC stamp.
   */
  exdates?: string[];
  /** TRANSPARENT for all-day markers (location, Off) so they don't block time. */
  transparent?: boolean;
}

export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line to 75 octets (continuations start with a space), UTF-8 safe. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** 2026-07-14T09:00:00.000Z → 20260714T090000Z */
export const utcStamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
/** 2026-07-14 → 20260714 */
const dateValue = (d: string) => d.replace(/-/g, '');

/** VTIMEZONE for Ireland/UK rules (GMT in winter, +1 from the last Sunday in March). */
function vtimezone(tzid: string): string[] {
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    'BEGIN:STANDARD',
    'DTSTART:19701025T020000',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T010000',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:IST',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
  ];
}
const GMT_ZONES = new Set(['Europe/Dublin', 'Europe/London', 'Europe/Belfast']);

export function buildCalendar(name: string, events: IcsEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Airhead//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const zones = new Set(events.map((e) => e.tzid).filter((z): z is string => !!z));
  for (const z of zones) if (GMT_ZONES.has(z)) lines.push(...vtimezone(z));
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utcStamp(e.stamp)}`);
    lines.push(`LAST-MODIFIED:${utcStamp(e.stamp)}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.start)}`);
      if (e.end) lines.push(`DTEND;VALUE=DATE:${dateValue(e.end)}`);
    } else if (e.localStart && e.tzid) {
      lines.push(`DTSTART;TZID=${e.tzid}:${e.localStart}`);
      if (e.localEnd) lines.push(`DTEND;TZID=${e.tzid}:${e.localEnd}`);
    } else {
      lines.push(`DTSTART:${utcStamp(e.start)}`);
      if (e.end) lines.push(`DTEND:${utcStamp(e.end)}`);
    }
    if (e.rrule) lines.push(`RRULE:${e.rrule.replace(/^RRULE:/, '')}`);
    for (const x of e.rrule ? (e.exdates ?? []) : []) {
      if (e.allDay) lines.push(`EXDATE;VALUE=DATE:${x}`);
      else if (e.localStart && e.tzid) lines.push(`EXDATE;TZID=${e.tzid}:${x}`);
      else lines.push(`EXDATE:${x}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.transparent) lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
