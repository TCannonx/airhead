import { describe, expect, it } from 'vitest';
import { dayOffSet } from '../holidays/ie';
import { findBridges, type BridgeInput } from './bridges';

const MON_FRI = [1, 2, 3, 4, 5];
const base = (over: Partial<BridgeInput> = {}): BridgeInput => ({
  from: '2026-04-01',
  to: '2026-06-30',
  workingDays: MON_FRI,
  daysOff: dayOffSet('2026-01-01', '2026-12-31'),
  booked: new Set(),
  busy: new Set(),
  balance: 10,
  ...over,
});

describe('bridge-day finder (Task 8.7)', () => {
  it('a Tuesday next to a bank holiday Monday gives the best ratio (Irish holidays)', () => {
    // Easter Monday 6 April 2026, May bank holiday 4 May, June bank holiday 1 June.
    const bridges = findBridges(base());
    const top = bridges[0];
    expect(top).toBeDefined();
    expect(top?.daysOff).toBeGreaterThanOrEqual(4);
    expect(top?.leave.length).toBe(1);
    expect(top?.ratio).toBe(4);
    // Every top result touches a bank holiday weekend.
    const firstFour = bridges.filter((b) => b.ratio === 4).map((b) => b.leave[0]);
    expect(firstFour).toEqual(expect.arrayContaining(['2026-04-07', '2026-05-05', '2026-06-02']));
    expect(firstFour).toEqual(expect.arrayContaining(['2026-04-03', '2026-05-01', '2026-05-29']));
  });

  it('two leave days around a weekend give four days off (ratio 2)', () => {
    const bridges = findBridges(
      base({ from: '2026-07-01', to: '2026-07-31', daysOff: new Set(), maxLeave: 2 }),
    );
    expect(bridges.every((b) => b.ratio === 2 && b.leave.length === 2 && b.daysOff === 4)).toBe(
      true,
    );
    expect(bridges.map((b) => b.leave)).toContainEqual(['2026-07-03', '2026-07-06']);
  });

  it('skips clashes, booked days and a balance that is too low', () => {
    const clash = findBridges(base({ busy: new Set(['2026-05-05']) }));
    expect(clash.some((b) => b.leave.includes('2026-05-05'))).toBe(false);
    const booked = findBridges(base({ booked: new Set(['2026-05-05']) }));
    // 4–5 May is already a run with the booked day; booking more extends it instead.
    expect(booked.some((b) => b.leave.includes('2026-05-05'))).toBe(false);
    expect(findBridges(base({ balance: 0 }))).toEqual([]);
    expect(findBridges(base({ balance: 1 })).every((b) => b.leave.length === 1)).toBe(true);
  });

  it('names the holidays inside each run and never returns the same run twice', () => {
    const bridges = findBridges(base());
    const easter = bridges.find((b) => b.leave[0] === '2026-04-07');
    expect(easter?.holidays).toContain('2026-04-06');
    const runs = bridges.map((b) => `${b.start}:${b.end}`);
    expect(new Set(runs).size).toBe(runs.length);
  });
});
