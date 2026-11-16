import type { PlanRunDay } from '../auth/types';

export interface PlanCostSummary {
  /** One row per day, newest first: cost per run kind. */
  days: { date: string; byKind: Record<string, number>; total: number }[];
  kinds: string[];
  total: number;
  lookups: number;
  /** Days on which no planner run succeeded and the defaults carried the day. */
  defaultsDays: number;
  /** Days with any planner activity. */
  activeDays: number;
}

/** Shapes plan_runs_daily rows for Insights (Task 17.4). */
export function summarisePlanCosts(rows: PlanRunDay[]): PlanCostSummary {
  const byDay = new Map<string, Record<string, number>>();
  const kinds = new Set<string>();
  let lookups = 0;
  const defaults = new Set<string>();
  for (const r of rows) {
    lookups += r.lookups_used;
    if (r.kind === 'defaults') {
      defaults.add(r.local_date);
      continue;
    }
    kinds.add(r.kind);
    const d = byDay.get(r.local_date) ?? {};
    d[r.kind] = (d[r.kind] ?? 0) + r.cost_eur;
    byDay.set(r.local_date, d);
  }
  const days = [...new Set([...byDay.keys(), ...defaults])]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const byKind = byDay.get(date) ?? {};
      return { date, byKind, total: Object.values(byKind).reduce((a, b) => a + b, 0) };
    });
  return {
    days,
    kinds: [...kinds].sort(),
    total: days.reduce((a, d) => a + d.total, 0),
    lookups,
    defaultsDays: defaults.size,
    activeDays: days.length,
  };
}
