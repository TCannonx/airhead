// Copied from src/lib/holidays (keep in step; Deno needs .ts import paths).
// calendar-feed/feed.test.ts checks the same dates as the app's tests.
import { addDays, easterSunday, isoDate, weekday } from './easter.ts';

/**
 * Irish public holidays, calculated on the device for any year (offline, no
 * maintenance). A public holiday on a weekend is NOT moved: Irish law gives a
 * paid day off within a month, an extra day of leave or an extra day's pay
 * instead, which is a work setting (Task 4.4), not a different date.
 */
export type HolidayKind = 'public' | 'common' | 'manual';

export interface Holiday {
  date: string;
  name: string;
  /** public = statutory; common = a usual day off that is not a holiday; manual = added in settings. */
  kind: HolidayKind;
}

export interface ManualHoliday {
  date: string;
  name: string;
}

/** The nth (1-based) given weekday of a month, as YYYY-MM-DD. */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  const first = isoDate(year, month, 1);
  const offset = (dow - weekday(first) + 7) % 7;
  return addDays(first, offset + 7 * (n - 1));
}

/** The last given weekday of a month, as YYYY-MM-DD. */
function lastWeekday(year: number, month: number, dow: number): string {
  const nextMonthFirst = month === 12 ? isoDate(year + 1, 1, 1) : isoDate(year, month + 1, 1);
  const last = addDays(nextMonthFirst, -1);
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

const MONDAY = 1;
const FRIDAY = 5;

/** St Brigid's Day (from 2023): the first Monday in February, or 1 February when that is a Friday. */
export function stBrigidsDay(year: number): string | null {
  if (year < 2023) return null;
  const feb1 = isoDate(year, 2, 1);
  return weekday(feb1) === FRIDAY ? feb1 : nthWeekday(year, 2, MONDAY, 1);
}

/** Statutory public holidays for a year, in date order. */
export function irishPublicHolidays(year: number): Holiday[] {
  const out: Holiday[] = [
    { date: isoDate(year, 1, 1), name: "New Year's Day", kind: 'public' },
    { date: isoDate(year, 3, 17), name: "St Patrick's Day", kind: 'public' },
    { date: addDays(easterSunday(year), 1), name: 'Easter Monday', kind: 'public' },
    { date: nthWeekday(year, 5, MONDAY, 1), name: 'May Bank Holiday', kind: 'public' },
    { date: nthWeekday(year, 6, MONDAY, 1), name: 'June Bank Holiday', kind: 'public' },
    { date: nthWeekday(year, 8, MONDAY, 1), name: 'August Bank Holiday', kind: 'public' },
    { date: lastWeekday(year, 10, MONDAY), name: 'October Bank Holiday', kind: 'public' },
    { date: isoDate(year, 12, 25), name: 'Christmas Day', kind: 'public' },
    { date: isoDate(year, 12, 26), name: "St Stephen's Day", kind: 'public' },
  ];
  const brigid = stBrigidsDay(year);
  if (brigid) out.push({ date: brigid, name: "St Brigid's Day", kind: 'public' });
  // The one-off holiday of 18 March 2022 (recognising the Covid-19 response).
  if (year === 2022)
    out.push({ date: '2022-03-18', name: 'Public holiday (one-off)', kind: 'public' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Usual days off that are not public holidays: Good Friday, Christmas Eve, New Year's Eve. */
export function commonDaysOff(year: number): Holiday[] {
  return [
    { date: addDays(easterSunday(year), -2), name: 'Good Friday', kind: 'common' as const },
    { date: isoDate(year, 12, 24), name: 'Christmas Eve', kind: 'common' as const },
    { date: isoDate(year, 12, 31), name: "New Year's Eve", kind: 'common' as const },
  ];
}

/**
 * Everything for a year: public holidays, common days off and the manual
 * one-offs from settings that fall in that year. A manual date that is already
 * a public holiday is not repeated.
 */
export function holidaysForYear(year: number, manual: ManualHoliday[] = []): Holiday[] {
  const publicDays = irishPublicHolidays(year);
  const taken = new Set(publicDays.map((h) => h.date));
  const extras = manual
    .filter((m) => m.date.startsWith(`${year}-`) && !taken.has(m.date))
    .map((m) => ({ date: m.date, name: m.name, kind: 'manual' as const }));
  return [...publicDays, ...commonDaysOff(year), ...extras].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/** All holidays (any kind) between two YYYY-MM-DD dates, inclusive. */
export function holidaysBetween(
  start: string,
  end: string,
  manual: ManualHoliday[] = [],
): Holiday[] {
  const out: Holiday[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (const h of holidaysForYear(y, manual)) if (h.date >= start && h.date <= end) out.push(h);
  }
  return out;
}

/**
 * Dates that are days off for leave counting: public holidays plus manual
 * one-offs (common days off are not, unless added manually).
 */
export function dayOffSet(start: string, end: string, manual: ManualHoliday[] = []): Set<string> {
  return new Set(
    holidaysBetween(start, end, manual)
      .filter((h) => h.kind !== 'common')
      .map((h) => h.date),
  );
}
