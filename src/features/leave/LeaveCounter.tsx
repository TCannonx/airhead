import { Link } from 'react-router';
import { currentBalance, paceText } from '../../lib/leave/engine';
import { daysText as days, longDate as date, leaveWarnings } from './warnings';
import { useWork, todayKey } from './useWork';

/** "12 days left · 19% used, 50% through the year" (Today and the Work screen). */
export default function LeaveCounter({ detailed = false }: { detailed?: boolean }) {
  const data = useWork();
  if (!data) return null;
  const b = currentBalance(data.bookings, data.work, todayKey());
  const rows: [string, number][] = [
    ['Entitlement', b.entitlement],
    ...(b.extra_days ? [['Extra (weekend holidays)', b.extra_days] as [string, number]] : []),
    ...(b.carry_over ? [['Carried over', b.carry_over] as [string, number]] : []),
    ...(b.carry_over_expired
      ? [['Carry-over expired', -b.carry_over_expired] as [string, number]]
      : []),
    ['Taken', -b.taken],
    ['Booked', -b.booked],
    ['Planned', -b.planned],
  ];

  if (!detailed) {
    return (
      <Link
        to="/work"
        aria-label="Leave"
        className="mb-6 block rounded-xl border border-emerald-200 bg-emerald-50 p-3 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:hover:bg-emerald-950"
      >
        <p className="font-medium">Leave: {days(b.remaining)} left</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{paceText(b)}</p>
        {leaveWarnings(b).map((w) => (
          <p key={w} className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
      </Link>
    );
  }

  return (
    <div aria-label="Leave balance">
      <p className="text-3xl font-semibold">
        {b.remaining} <span className="text-base font-normal text-slate-500">days left</span>
      </p>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {paceText(b)} · leave year {date(b.year.start)} – {date(b.year.end)}
      </p>
      <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {rows.map(([label, n]) => (
          <div key={label} className="contents">
            <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
            <dd className="text-right tabular-nums">
              {n > 0 && label !== 'Entitlement' ? `+${n}` : n}
            </dd>
          </div>
        ))}
        <dt className="border-t border-slate-200 pt-1 font-medium dark:border-slate-800">
          Remaining
        </dt>
        <dd className="border-t border-slate-200 pt-1 text-right font-medium tabular-nums dark:border-slate-800">
          {b.remaining}
        </dd>
      </dl>
      {leaveWarnings(b).map((w) => (
        <p key={w} role="note" className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
    </div>
  );
}
