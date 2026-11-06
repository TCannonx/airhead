export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type Span = [start: number, end: number];

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay: Weekday[];
  byMonthDay: number | null;
  /** Parts of the text that expressed the recurrence (removed from the title). */
  spans: Span[];
}

const WD_SOURCE =
  '(mon(?:day)?s?|tue(?:s|sday)?s?|wed(?:s|nesday)?s?|thu(?:r|rs|rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)';
const WD_ORDER: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function weekdayCode(token: string): Weekday {
  const t = token.toLowerCase();
  if (t.startsWith('mon')) return 'MO';
  if (t.startsWith('tue')) return 'TU';
  if (t.startsWith('wed')) return 'WE';
  if (t.startsWith('thu')) return 'TH';
  if (t.startsWith('fri')) return 'FR';
  if (t.startsWith('sat')) return 'SA';
  return 'SU';
}

const sortDays = (days: Weekday[]) =>
  [...new Set(days)].sort((a, b) => WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b));

const span = (m: RegExpExecArray): Span => [m.index, m.index + m[0].length];

/** Finds common recurrence phrases ("every Monday", "Tues and Thurs", "monthly on the 1st"...). */
export function parseRecurrence(text: string): Recurrence | null {
  const spans: Span[] = [];
  let freq: Recurrence['freq'] | null = null;
  let interval = 1;
  let byDay: Weekday[] = [];
  let byMonthDay: number | null = null;
  let m: RegExpExecArray | null;

  // Intervals: fortnightly, every other week, every N days/weeks/months.
  if ((m = /\b(?:every\s+(?:other|second|2nd)\s+week|fortnightly)\b/i.exec(text))) {
    freq = 'WEEKLY';
    interval = 2;
    spans.push(span(m));
  } else if ((m = /\bevery\s+(\d+)\s+(day|week|month)s?\b/i.exec(text))) {
    const unit = (m[2] ?? '').toLowerCase();
    freq = unit === 'day' ? 'DAILY' : unit === 'week' ? 'WEEKLY' : 'MONTHLY';
    interval = Math.max(1, Number(m[1]));
    spans.push(span(m));
  }

  if ((m = /\b(?:every\s+weekday|weekdays|mon(?:day)?\s*(?:-|to)\s*fri(?:day)?)\b/i.exec(text))) {
    freq = 'WEEKLY';
    byDay = ['MO', 'TU', 'WE', 'TH', 'FR'];
    spans.push(span(m));
  } else if (!freq && (m = /\b(?:every\s*day|daily)\b/i.exec(text))) {
    freq = 'DAILY';
    spans.push(span(m));
  }

  if (byDay.length === 0) {
    const list = new RegExp(`\\b${WD_SOURCE}(?:\\s*(?:,|and|&|\\+)\\s*${WD_SOURCE})+\\b`, 'i');
    const every = new RegExp(`\\b(?:every|each)\\s+${WD_SOURCE}\\b`, 'i');
    const plural = /\b(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/i;
    const single = new RegExp(`\\b${WD_SOURCE}\\b`, 'i');
    if ((m = list.exec(text))) {
      const tokens = m[0].match(new RegExp(WD_SOURCE, 'gi')) ?? [];
      byDay = sortDays(tokens.map(weekdayCode));
      freq = freq ?? 'WEEKLY';
      spans.push(span(m));
    } else if ((m = every.exec(text)) || (m = plural.exec(text))) {
      byDay = [weekdayCode(m[1] ?? '')];
      freq = freq ?? 'WEEKLY';
      spans.push(span(m));
    } else if (freq === 'WEEKLY' && (m = single.exec(text))) {
      // "every 2 weeks on Monday"
      byDay = [weekdayCode(m[1] ?? '')];
      spans.push(span(m));
    }
  }

  if (!freq && (m = /\b(?:every\s+week|weekly)\b/i.exec(text))) {
    freq = 'WEEKLY';
    spans.push(span(m));
  }
  if ((m = /\b(?:every\s+month|monthly)\b/i.exec(text))) {
    freq = freq ?? 'MONTHLY';
    spans.push(span(m));
  }
  if (freq === 'MONTHLY' && (m = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text))) {
    byMonthDay = Number(m[1]);
    spans.push(span(m));
  }
  if (!freq && (m = /\b(?:every\s+year|yearly|annually)\b/i.exec(text))) {
    freq = 'YEARLY';
    spans.push(span(m));
  }

  if (!freq) return null;
  return { freq, interval, byDay, byMonthDay, spans };
}

/** RRULE text (no DTSTART; the item's start_at is the first occurrence). */
export function toRRule(r: Pick<Recurrence, 'freq' | 'interval' | 'byDay' | 'byMonthDay'>) {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay.length) parts.push(`BYDAY=${r.byDay.join(',')}`);
  if (r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay}`);
  return parts.join(';');
}

export const WEEKDAY_INDEX: Record<Weekday, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};
