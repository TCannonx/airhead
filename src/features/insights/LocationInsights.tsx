import { addDays } from '../../lib/holidays/easter';
import { WORK_LOCATIONS } from '../../lib/schemas/records';
import { locationsBy, mondayOf, type LocationRow } from '../../lib/work/locationStats';
import { LOCATION_LABELS } from '../../lib/work/settings';
import { useCalendarData } from '../calendar/useCalendarData';
import { todayKey } from '../leave/useWork';

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const monthName = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-IE', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

function Table({
  caption,
  rows,
  label,
}: {
  caption: string;
  rows: LocationRow[];
  label: (p: string) => string;
}) {
  // Only columns that were used in the period, so the table stays narrow.
  const cols = WORK_LOCATIONS.filter((l) => rows.some((r) => r.counts[l] > 0));
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left text-sm font-medium">{caption}</caption>
      <thead>
        <tr className="text-left text-xs text-slate-500">
          <th scope="col" className="py-1 font-medium">
            Period
          </th>
          {cols.map((l) => (
            <th key={l} scope="col" className="py-1 text-right font-medium">
              {LOCATION_LABELS[l]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.period} className="border-t border-slate-100 dark:border-slate-800">
            <th scope="row" className="py-1 text-left font-normal">
              {label(r.period)}
            </th>
            {cols.map((l) => (
              <td key={l} className="py-1 text-right tabular-nums">
                {r.counts[l] || '–'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Insights → where I worked, by week (last 8) and month (last 6), up to today (Task 4.7). */
export default function LocationInsights() {
  const data = useCalendarData();
  if (!data) return null;
  const today = todayKey();
  const weeks = locationsBy('week', addDays(mondayOf(today), -7 * 7), today, data).reverse();
  const firstMonth = (() => {
    const [y, m] = today.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 - 5, 1));
    return d.toISOString().slice(0, 10);
  })();
  const months = locationsBy('month', firstMonth, today, data).reverse();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Table caption="By week" rows={weeks} label={(p) => `w/c ${shortDate(p)}`} />
      <Table caption="By month" rows={months} label={monthName} />
    </div>
  );
}
