import { Link } from 'react-router';
import { Icon } from '../../app/Icon';
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
        className="mb-8 flex min-h-11 items-center gap-3 rounded-card border border-border/60 bg-surface px-4 py-3 transition outline-none hover:bg-fill/60 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium">Leave: {days(b.remaining)} left</span>
          <span className="block text-footnote text-fg-muted">{paceText(b)}</span>
          {leaveWarnings(b).map((w) => (
            <span key={w} className="mt-1 block text-footnote text-warning">
              {w}
            </span>
          ))}
        </span>
        <Icon name="chevron-right" className="size-4 shrink-0 text-fg-subtle" />
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
