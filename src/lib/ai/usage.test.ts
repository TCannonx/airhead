import { describe, expect, it } from 'vitest';
import { estimateCost, summariseUsage, type UsageRow } from './usage';

const row = (created_at: string, task: string, cost_eur: number, ok = true): UsageRow => ({
  task,
  tier: 'small',
  model: 'claude-haiku-5-5',
  cost_eur,
  ok,
  error_code: ok ? null : 'invalid_output',
  created_at,
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_tokens: 0,
});

// Saturday 7 November 2026, 12:00 Dublin
const NOW = new Date('2026-11-07T12:00:00Z');

describe('summariseUsage', () => {
  const rows = [
    row('2026-10-31T23:30:00Z', 'sort_batch', 5), // last month: excluded
    row('2026-11-01T00:30:00Z', 'sort_batch', 0.1),
    row('2026-11-01T09:00:00Z', 'read_link', 0.05),
    row('2026-11-06T18:00:00Z', 'sort_batch', 0.2),
    row('2026-11-07T08:00:00Z', 'sort_batch', 0.05, false), // failed attempts still cost
  ];
  const s = summariseUsage(rows, NOW, 'Europe/Dublin');

  it('totals the calendar month to date in the user’s time zone', () => {
    expect(s.monthToDate).toBeCloseTo(0.4);
    expect(s.calls).toBe(4);
  });

  it('breaks it down by task, biggest first', () => {
    expect(s.byTask).toEqual([
      { task: 'sort_batch', cost: expect.closeTo(0.35), calls: 3 },
      { task: 'read_link', cost: expect.closeTo(0.05), calls: 1 },
    ]);
  });

  it('has one bar per day so far', () => {
    expect(s.daily.map((d) => d.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
    expect(s.daily[0]?.cost).toBeCloseTo(0.15);
    expect(s.daily[1]?.cost).toBe(0);
  });

  it('projects month-end as month-to-date ÷ days elapsed × days in month', () => {
    expect(s.projected).toBeCloseTo((0.4 / 7) * 30);
  });

  it('copes with no usage', () => {
    const empty = summariseUsage([], NOW, 'Europe/Dublin');
    expect(empty).toMatchObject({ monthToDate: 0, projected: 0, calls: 0, byTask: [] });
  });
});

describe('estimateCost', () => {
  it('averages the last 10 successful calls of that task', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(
        `2026-11-05T10:${String(i).padStart(2, '0')}:00Z`, // strictly increasing
        'brief',
        i < 2 ? 9 : 0.02,
      ),
    );
    rows.push(row('2026-11-07T11:00:00Z', 'brief', 5, false));
    // Newest 10 successful ones are all 0.02 (the two 9s are the oldest).
    expect(estimateCost(rows, 'brief', 0.5)).toBeCloseTo(0.02);
  });

  it('falls back to a default when the task has no history', () => {
    expect(estimateCost([], 'brief', 0.03)).toBe(0.03);
  });
});
