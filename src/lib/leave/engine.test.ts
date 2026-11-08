import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SETTINGS, type WorkSettings } from '../work/settings';
import {
  addMonths,
  balanceFor,
  carryOverInto,
  countLeaveDays,
  currentBalance,
  holidaysOnDaysOff,
  isLeaveDay,
  leaveYearFor,
  paceText,
  type BookingLike,
} from './engine';

const S = DEFAULT_WORK_SETTINGS; // Mon–Fri, year from 1 Dec, 21 days, carry 5 for 3 months
const w = (patch: Partial<WorkSettings>): WorkSettings => ({ ...S, ...patch });
const b = (start: string, end: string, extra: Partial<BookingLike> = {}): BookingLike => ({
  start_date: start,
  end_date: end,
  start_half: false,
  end_half: false,
  leave_type: 'annual',
  status: 'approved',
  ...extra,
});
const Y26 = { start: '2025-12-01', end: '2026-11-30' };
const Y27 = { start: '2026-12-01', end: '2027-11-30' };

describe('leave years', () => {
  it.each([
    ['2026-11-07', Y26],
    ['2026-11-30', Y26],
    ['2026-12-01', Y27],
    ['2028-02-29', { start: '2027-12-01', end: '2028-11-30' }],
  ])('%s is in %o (1 December start)', (date, year) => {
    expect(leaveYearFor(date, S)).toEqual(year);
  });

  it('a 1 January start gives the calendar year', () => {
    expect(leaveYearFor('2026-06-15', w({ leave_year_start: '01-01' }))).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });

  it('adds months, clamping to the month end', () => {
    expect(addMonths('2026-12-01', 3)).toBe('2027-03-01');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15');
  });
});

describe('counting working days', () => {
  it('a full Monday to Friday week is 5', () => {
    expect(countLeaveDays(b('2026-07-13', '2026-07-17'), S)).toBe(5);
  });

  it('a week with a public holiday (St Brigid’s Day) is 4', () => {
    expect(countLeaveDays(b('2026-02-02', '2026-02-06'), S)).toBe(4);
  });

  it('the Easter Monday week is 4', () => {
    expect(countLeaveDays(b('2026-04-06', '2026-04-10'), S)).toBe(4);
  });

  it('skips the weekend', () => {
    expect(countLeaveDays(b('2026-07-10', '2026-07-13'), S)).toBe(2);
  });

  it('half days at either end', () => {
    expect(countLeaveDays(b('2026-07-13', '2026-07-17', { start_half: true }), S)).toBe(4.5);
    expect(countLeaveDays(b('2026-07-13', '2026-07-17', { end_half: true }), S)).toBe(4.5);
    expect(
      countLeaveDays(b('2026-07-13', '2026-07-17', { start_half: true, end_half: true }), S),
    ).toBe(4);
  });

  it('a single half day is 0.5', () => {
    expect(countLeaveDays(b('2026-07-14', '2026-07-14', { end_half: true }), S)).toBe(0.5);
  });

  it('a half day on a weekend costs nothing', () => {
    expect(countLeaveDays(b('2026-07-11', '2026-07-13', { start_half: true }), S)).toBe(1);
  });

  it('over Christmas: holidays skipped, Christmas Eve and New Year’s Eve count', () => {
    // Mon 21 to Thu 24, (Fri 25 holiday), Mon 28 to Thu 31, (Fri 1 Jan holiday)
    expect(countLeaveDays(b('2026-12-21', '2027-01-01'), S)).toBe(8);
  });

  it('respects non-working days', () => {
    expect(countLeaveDays(b('2026-07-13', '2026-07-17'), w({ working_days: [1, 2, 3, 4] }))).toBe(
      4,
    );
  });

  it('skips closure days and manual one-off holidays', () => {
    const s = w({
      closure_days: ['2026-12-29'],
      manual_holidays: [{ date: '2026-12-30', name: 'Company day' }],
    });
    expect(countLeaveDays(b('2026-12-21', '2027-01-01'), s)).toBe(6);
  });

  it('counts only the part inside a window', () => {
    expect(countLeaveDays(b('2026-11-26', '2026-12-04'), S, Y26.start, Y26.end)).toBe(3);
    expect(countLeaveDays(b('2026-11-26', '2026-12-04'), S, Y27.start, Y27.end)).toBe(4);
  });

  it('isLeaveDay: weekends and holidays are not leave days', () => {
    expect(isLeaveDay('2026-07-13', S)).toBe(true);
    expect(isLeaveDay('2026-07-11', S)).toBe(false);
    expect(isLeaveDay('2026-03-17', S)).toBe(false);
  });
});

describe('balances', () => {
  it('entitlement minus taken, booked and planned', () => {
    const bookings = [
      b('2026-02-02', '2026-02-06', { status: 'taken' }), // 4
      b('2026-07-13', '2026-07-15', { status: 'approved' }), // 3
      b('2026-08-10', '2026-08-11', { status: 'planned' }), // 2
    ];
    const bal = balanceFor(Y26, bookings, S, '2026-06-01');
    expect(bal).toMatchObject({ taken: 4, booked: 3, planned: 2, total: 21, remaining: 12 });
  });

  it('approved leave whose dates have passed counts as taken', () => {
    const bal = balanceFor(Y26, [b('2026-07-13', '2026-07-17')], S, '2026-08-01');
    expect(bal.taken).toBe(5);
    expect(bal.booked).toBe(0);
  });

  it('ignores deleted bookings and non-deducting leave types', () => {
    const bookings = [
      b('2026-07-13', '2026-07-17', { deleted_at: '2026-07-01T00:00:00Z' }),
      b('2026-03-02', '2026-03-04', { leave_type: 'sick', status: 'taken' }),
    ];
    expect(balanceFor(Y26, bookings, S, '2026-08-01').remaining).toBe(21);
  });

  it('a booking crossing the 1 December boundary is split between the two years', () => {
    const bookings = [b('2026-11-26', '2026-12-04')];
    expect(balanceFor(Y26, bookings, S, '2026-11-01').booked).toBe(3);
    expect(balanceFor(Y27, bookings, S, '2026-11-01').booked).toBe(4);
  });

  it('five days over a public holiday deduct four', () => {
    expect(balanceFor(Y26, [b('2026-04-06', '2026-04-10')], S, '2026-03-01').remaining).toBe(17);
  });

  it('a weekend public holiday adds a day when compensated with leave', () => {
    // St Stephen's Day 2026 is a Saturday.
    expect(holidaysOnDaysOff(Y27, S)).toEqual(['2026-12-26']);
    expect(balanceFor(Y27, [], w({ weekend_holiday: 'extra_leave' }), '2026-12-01').total).toBe(22);
    expect(balanceFor(Y27, [], S, '2026-12-01').total).toBe(21);
  });

  it('closure days that use leave are deducted once', () => {
    const s = w({ closure_uses_leave: true, closure_days: ['2026-12-29', '2026-12-26'] });
    const bal = balanceFor(Y27, [b('2026-12-21', '2027-01-01')], s, '2026-12-01');
    // Booking: 8 days minus the closure day = 7; the closure itself: 1 (the 26th is a Saturday).
    expect(bal.closure).toBe(1);
    expect(bal.booked).toBe(8);
    expect(bal.remaining).toBe(13);
  });
});

describe('carry-over', () => {
  it('carries the previous year’s remaining days, up to the maximum', () => {
    const prev = [b('2026-07-13', '2026-07-17', { status: 'taken' })]; // 21 - 5 = 16 left
    expect(carryOverInto(Y27, prev, S)).toBe(5);
    expect(carryOverInto(Y27, prev, w({ carry_over_max: 20 }))).toBe(16);
  });

  it('carries less when less was left', () => {
    const march = b('2026-03-02', '2026-03-27', { status: 'taken' }); // 19 days (17 March off)
    const prev = [march];
    expect(countLeaveDays(march, S)).toBe(19);
    expect(carryOverInto(Y27, prev, S)).toBe(2);
  });

  it('nothing carries without any history', () => {
    expect(carryOverInto(Y27, [], S)).toBe(0);
  });

  it('a carry-over entered by hand wins', () => {
    expect(carryOverInto(Y27, [], w({ opening_carry_over: { '2026-12-01': 3.5 } }))).toBe(3.5);
  });

  it('a hand-entered opening balance flows on into the next year', () => {
    const s = w({ opening_carry_over: { '2025-12-01': 4 }, carry_over_max: 10 });
    // 2025/26: 21 + 4 (expires 1 March, unused) = 21 left; carry the maximum, 10.
    expect(carryOverInto(Y27, [], s)).toBe(10);
  });

  it('unused carried-over days are at risk, then expire after 3 months', () => {
    const s = w({ opening_carry_over: { '2026-12-01': 5 } });
    const bookings = [b('2027-01-11', '2027-01-12', { status: 'taken' })]; // 2 days before 1 March
    const before = balanceFor(Y27, bookings, s, '2027-02-01');
    expect(before).toMatchObject({
      carry_over_expires: '2027-03-01',
      carry_over_at_risk: 3,
      carry_over_expired: 0,
      total: 26,
    });
    const after = balanceFor(Y27, bookings, s, '2027-03-01');
    expect(after).toMatchObject({
      carry_over_at_risk: 0,
      carry_over_expired: 3,
      total: 23,
      remaining: 21,
    });
  });

  it('carry-over used up in time does not expire; "never" keeps it all year', () => {
    const s = w({ opening_carry_over: { '2026-12-01': 2 } });
    const bookings = [b('2027-01-11', '2027-01-13', { status: 'taken' })];
    expect(balanceFor(Y27, bookings, s, '2027-06-01').carry_over_expired).toBe(0);
    const never = w({ opening_carry_over: { '2026-12-01': 5 }, carry_over_expiry_months: null });
    expect(balanceFor(Y27, [], never, '2027-06-01')).toMatchObject({
      carry_over_expires: null,
      total: 26,
    });
  });
});

describe('pace and run-out', () => {
  it('pace compares days taken with time gone', () => {
    const bal = balanceFor(
      Y26,
      [b('2026-02-02', '2026-02-06', { status: 'taken' })],
      S,
      '2026-05-31',
    );
    // 4 of 21 taken (19%); 182 of 365 days gone (50%).
    expect(bal.pace).toEqual({ used_pct: 19, through_pct: 50 });
    expect(paceText(bal)).toBe('19% used, 50% through the year');
  });

  it('days beyond the carry-over allowance would be lost', () => {
    const bal = balanceFor(
      Y26,
      [b('2026-07-13', '2026-07-16', { status: 'taken' })],
      S,
      '2026-09-01',
    );
    expect(bal.remaining).toBe(17);
    expect(bal.lose_at_year_end).toBe(12);
  });

  it('currentBalance uses the leave year containing today', () => {
    expect(currentBalance([], S, '2026-12-15').year).toEqual(Y27);
  });
});

describe('opening_used (days used before Airhead)', () => {
  const settings: WorkSettings = { ...S, opening_used: { '2025-12-01': 11.5 } };
  it('counts as taken in its own leave year only', () => {
    const b = balanceFor(leaveYearFor('2026-11-08', settings), [], settings, '2026-11-08');
    expect(b.taken).toBe(11.5);
    expect(b.remaining).toBe(9.5);
    const next = balanceFor(leaveYearFor('2026-12-05', settings), [], settings, '2026-12-05');
    expect(next.taken).toBe(0);
  });
});
