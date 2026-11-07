import { TZDate } from '@date-fns/tz';
import * as chrono from 'chrono-node';

/**
 * Capture rule for leave (Task 4.6): "AL 14–18 July", "annual leave 3 Aug",
 * "half day leave Friday", "sick 2-3 March". Proposes a booking; it never
 * books on its own.
 */
export interface LeaveProposal {
  start_date: string;
  end_date: string;
  start_half: boolean;
  end_half: boolean;
  leave_type: string;
}

const LEAVE_WORDS =
  /^\s*(?:(half(?:\s|-)?day)\s+)?(al|a\/l|annual\s+leave|leave|day\s+off|days\s+off|sick(?:\s+leave|\s+day)?|off\s+sick)\b[\s:,-]*(?:(half(?:\s|-)?day)\b\s*)?/i;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date, tz: string) => {
  const t = new TZDate(d.getTime(), tz);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

export function parseLeave(text: string, now: Date, timeZone: string): LeaveProposal | null {
  const m = LEAVE_WORDS.exec(text);
  if (!m) return null;
  const rest = text
    .slice(m[0].length)
    // "14–18 July": chrono reads ASCII hyphen ranges; normalise dashes and "to".
    .replace(/[–—]/g, '-')
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|to)\s*(\d{1,2})(?:st|nd|rd|th)?\b/gi, '$1 - $2');
  const result = chrono.en.GB.parse(
    rest,
    { instant: now, timezone: timeZone },
    { forwardDate: true },
  )[0];
  // The date must follow the leave words straight away ("Leave for the airport Friday" is not leave).
  if (!result || rest.slice(0, result.index).trim()) return null;
  // Leave is whole dates; a time means it's an appointment, not leave.
  if (result.start.isCertain('hour')) return null;
  const start = ymd(result.start.date(), timeZone);
  const end = result.end ? ymd(result.end.date(), timeZone) : start;
  if (end < start) return null;
  const word = (m[2] ?? '').toLowerCase();
  const half = !!(m[1] || m[3] || /\bhalf(?:\s|-)?day\b/i.test(rest));
  const pm = /\b(?:pm|afternoon)\b/i.test(rest);
  return {
    start_date: start,
    end_date: end,
    // A half day on one date: morning off = ends at midday; afternoon = starts at midday.
    start_half: half && start === end ? pm : false,
    end_half: half ? (start === end ? !pm : true) : false,
    leave_type: word.includes('sick') ? 'sick' : 'annual',
  };
}
