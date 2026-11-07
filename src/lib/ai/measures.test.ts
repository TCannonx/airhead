import { describe, expect, it } from 'vitest';
import { baseRecord, newCapture, newItem } from '../db/repository';
import type { Correction } from '../schemas/records';
import { monthlyCosts, successMeasures } from './measures';
import type { UsageRow } from './usage';

const U = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('successMeasures (last 30 days)', () => {
  it('captures per day, correction rate, and counts', () => {
    const captures = [
      ...Array.from({ length: 45 }, (_, i) => newCapture(U, { captured_at: daysAgo(i % 30) })),
      newCapture(U, { captured_at: daysAgo(40) }), // too old
      { ...newCapture(U, { captured_at: daysAgo(1) }), deleted_at: daysAgo(0) }, // deleted
    ];
    const items = [
      ...Array.from({ length: 20 }, () => ({
        ...newItem(U, { type: 'task', title: 't', capture_id: 'c' }),
        created_at: daysAgo(3),
      })),
      { ...newItem(U, { type: 'task', title: 'manual, no capture' }), created_at: daysAgo(3) },
      { ...newItem(U, { type: 'task', title: 'old', capture_id: 'c' }), created_at: daysAgo(45) },
    ];
    const corrections: Correction[] = [
      { ...baseRecord(U), capture_id: 'c', from_value: {}, to_value: {}, created_at: daysAgo(2) },
      { ...baseRecord(U), capture_id: 'c', from_value: {}, to_value: {}, created_at: daysAgo(5) },
      { ...baseRecord(U), capture_id: 'c', from_value: {}, to_value: {}, created_at: daysAgo(50) },
    ];

    const m = successMeasures({ captures, items, corrections }, NOW);
    expect(m.capturesPerDay).toBeCloseTo(45 / 30);
    expect(m.itemsSorted).toBe(20);
    expect(m.corrections).toBe(2);
    expect(m.correctionRate).toBeCloseTo(0.1);
  });

  it('a correction rate of 0 with nothing sorted (no division by zero)', () => {
    const m = successMeasures({ captures: [], items: [], corrections: [] }, NOW);
    expect(m).toMatchObject({ capturesPerDay: 0, correctionRate: 0, itemsSorted: 0 });
  });
});

describe('monthlyCosts', () => {
  const row = (created_at: string, cost_eur: number): UsageRow => ({
    task: 'sort_batch',
    tier: 'small',
    model: 'm',
    cost_eur,
    ok: true,
    error_code: null,
    created_at,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
  });

  it('totals each of the last N calendar months, oldest first, including empty months', () => {
    const rows = [
      row('2026-11-10T10:00:00Z', 0.5),
      row('2026-11-01T00:30:00Z', 0.25), // 1 Nov 00:30 Dublin
      row('2026-09-15T10:00:00Z', 1),
      row('2026-06-01T10:00:00Z', 9), // outside the window
    ];
    expect(monthlyCosts(rows, NOW, 'Europe/Dublin', 3)).toEqual([
      { month: '2026-09', cost: 1 },
      { month: '2026-10', cost: 0 },
      { month: '2026-11', cost: 0.75 },
    ]);
  });
});
