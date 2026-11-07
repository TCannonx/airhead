import { locationFor, type CalendarData } from '../calendar/sources';
import { addDays, weekday } from '../holidays/easter';
import { WORK_LOCATIONS, type WorkLocation } from '../schemas/records';

/** Days per location in one period (Task 4.7). Off is counted too, for completeness. */
export interface LocationRow {
  /** Week: the Monday's date; month: YYYY-MM. */
  period: string;
  counts: Record<WorkLocation, number>;
}

type Data = Pick<CalendarData, 'workDays' | 'leave' | 'work'>;

const empty = (): Record<WorkLocation, number> =>
  Object.fromEntries(WORK_LOCATIONS.map((l) => [l, 0])) as Record<WorkLocation, number>;

/** The Monday on or before a date. */
export const mondayOf = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/**
 * Counts each day's location from `from` to `to` (inclusive), grouped by ISO
 * week (Monday start) or calendar month, oldest first. Only working days count
 * towards WFH/Office/…; non-working days are left out entirely.
 */
export function locationsBy(
  unit: 'week' | 'month',
  from: string,
  to: string,
  data: Data,
): LocationRow[] {
  const rows = new Map<string, Record<WorkLocation, number>>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!data.work.working_days.includes(weekday(d))) continue;
    const key = unit === 'week' ? mondayOf(d) : d.slice(0, 7);
    const counts = rows.get(key) ?? empty();
    counts[locationFor(d, data)] += 1;
    rows.set(key, counts);
  }
  return [...rows.entries()].map(([period, counts]) => ({ period, counts }));
}
