import { useEffect, useState } from 'react';
import { summarisePlanCosts, type PlanCostSummary } from '../../lib/ai/planCosts';
import { useAuth } from '../../lib/auth/context';

const euro = (n: number) => `€${n.toFixed(n < 0.1 ? 3 : 2)}`;
const KIND_NAMES: Record<string, string> = {
  evening: 'Evening',
  morning: 'Morning',
  replan: 'Re-plan',
  weekly: 'Weekly',
  learning: 'Learning',
};

/** Insights → Planner costs (Task 17.4): cost per day by run kind, look-ups, defaults days. */
export default function PlanCosts() {
  const { services } = useAuth();
  const usage = services.usage;
  const [s, setS] = useState<PlanCostSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!usage?.planDays) return;
    const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
    usage
      .planDays(since)
      .then((rows) => setS(summarisePlanCosts(rows)))
      .catch(() => setFailed(true));
  }, [usage]);

  if (!usage?.planDays)
    return <p className="text-footnote text-fg-muted">Needs Airhead’s server.</p>;
  if (failed)
    return <p className="text-footnote text-fg-muted">Couldn’t load the planner’s costs.</p>;
  if (!s) return null;
  if (!s.activeDays)
    return <p className="text-footnote text-fg-muted">The planner hasn’t run yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-footnote">
        Last 14 days: {euro(s.total)} on planning · {s.lookups} look-up{s.lookups === 1 ? '' : 's'}{' '}
        · defaults carried {s.defaultsDays} day{s.defaultsDays === 1 ? '' : 's'}
      </p>
      <table aria-label="Planner cost by day" className="w-full text-footnote tabular-nums">
        <thead>
          <tr className="text-left text-fg-muted">
            <th className="font-normal">Day</th>
            {s.kinds.map((k) => (
              <th key={k} className="font-normal">
                {KIND_NAMES[k] ?? k}
              </th>
            ))}
            <th className="font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {s.days.map((d) => (
            <tr key={d.date}>
              <td>{d.date.slice(5)}</td>
              {s.kinds.map((k) => (
                <td key={k}>{d.byKind[k] ? euro(d.byKind[k]) : '—'}</td>
              ))}
              <td>{d.total ? euro(d.total) : 'defaults'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
