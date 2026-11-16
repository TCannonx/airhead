import { describe, expect, it } from 'vitest';
import { summarisePlanCosts } from './planCosts';

const row = (local_date: string, kind: string, cost_eur: number, lookups_used = 0) => ({
  local_date,
  kind,
  runs: 1,
  ok_runs: kind === 'defaults' ? 1 : 1,
  capped_runs: 0,
  nudges_written: 2,
  lookups_used,
  cost_eur,
});

describe('planner costs (Task 17.4)', () => {
  it('cost per day by run kind, look-ups and days the defaults carried', () => {
    const s = summarisePlanCosts([
      row('2026-11-16', 'evening', 0.004, 2),
      row('2026-11-16', 'replan', 0.001),
      row('2026-11-17', 'morning', 0.002, 1),
      row('2026-11-15', 'defaults', 0),
    ]);
    expect(s.kinds).toEqual(['evening', 'morning', 'replan']);
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-17', '2026-11-16', '2026-11-15']);
    expect(s.days[1]?.byKind).toEqual({ evening: 0.004, replan: 0.001 });
    expect(s.total).toBeCloseTo(0.007);
    expect([s.lookups, s.defaultsDays, s.activeDays]).toEqual([3, 1, 3]);
  });
});
