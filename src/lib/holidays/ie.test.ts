import { describe, expect, it } from 'vitest';
import { addDays, easterSunday, weekday } from './easter';
import {
  commonDaysOff,
  dayOffSet,
  holidaysBetween,
  holidaysForYear,
  irishPublicHolidays,
  stBrigidsDay,
} from './ie';

const named = (year: number, name: string) =>
  irishPublicHolidays(year).find((h) => h.name === name)?.date;

describe('Easter (Gregorian computus)', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'],
    [2285, '2285-03-22'],
  ])('%i → %s', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });

  it('date helpers cross month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(weekday('2026-11-07')).toBe(6);
  });
});

describe("St Brigid's Day", () => {
  it.each([
    [2023, '2023-02-06'],
    [2024, '2024-02-05'],
    [2025, '2025-02-03'],
    [2026, '2026-02-02'],
    [2027, '2027-02-01'],
    [2030, '2030-02-01'],
  ])('%i → %s', (year, date) => {
    expect(stBrigidsDay(year)).toBe(date);
    expect(named(year, "St Brigid's Day")).toBe(date);
  });

  it('1 February 2030 is a Friday, so it is the holiday', () => {
    expect(weekday('2030-02-01')).toBe(5);
  });

  it('does not exist before 2023', () => {
    expect(stBrigidsDay(2022)).toBeNull();
    expect(named(2022, "St Brigid's Day")).toBeUndefined();
  });
});

describe('Irish public holidays', () => {
  it('Easter Monday 2026 and 2027', () => {
    expect(named(2026, 'Easter Monday')).toBe('2026-04-06');
    expect(named(2027, 'Easter Monday')).toBe('2027-03-29');
  });

  it('October holiday 2026 is the last Monday', () => {
    expect(named(2026, 'October Bank Holiday')).toBe('2026-10-26');
  });

  it('2026 matches Citizens Information', () => {
    expect(irishPublicHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-02-02',
      '2026-03-17',
      '2026-04-06',
      '2026-05-04',
      '2026-06-01',
      '2026-08-03',
      '2026-10-26',
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  it('2027 matches Citizens Information', () => {
    expect(irishPublicHolidays(2027).map((h) => h.date)).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-17',
      '2027-03-29',
      '2027-05-03',
      '2027-06-07',
      '2027-08-02',
      '2027-10-25',
      '2027-12-25',
      '2027-12-26',
    ]);
  });

  it('includes the one-off 18 March 2022 holiday', () => {
    expect(irishPublicHolidays(2022).map((h) => h.date)).toContain('2022-03-18');
    expect(irishPublicHolidays(2023).map((h) => h.date)).not.toContain('2023-03-18');
  });

  it('does not move a holiday that falls on a weekend', () => {
    // Christmas Day 2027 is a Saturday, St Stephen's Day a Sunday.
    expect(weekday('2027-12-25')).toBe(6);
    expect(named(2027, 'Christmas Day')).toBe('2027-12-25');
    expect(named(2027, "St Stephen's Day")).toBe('2027-12-26');
  });
});

describe('common days off and manual holidays', () => {
  it('Good Friday, Christmas Eve and New Year’s Eve are common days off, not holidays', () => {
    expect(commonDaysOff(2026).map((h) => h.date)).toEqual([
      '2026-04-03',
      '2026-12-24',
      '2026-12-31',
    ]);
    const kinds = Object.fromEntries(holidaysForYear(2026).map((h) => [h.date, h.kind]));
    expect(kinds['2026-04-03']).toBe('common');
    expect(kinds['2026-12-25']).toBe('public');
  });

  it('merges manual one-offs for that year, without repeating a public holiday', () => {
    const manual = [
      { date: '2026-07-10', name: 'Company day' },
      { date: '2026-12-25', name: 'Duplicate' },
      { date: '2027-07-09', name: 'Next year' },
    ];
    const year = holidaysForYear(2026, manual);
    expect(year.filter((h) => h.kind === 'manual')).toEqual([
      { date: '2026-07-10', name: 'Company day', kind: 'manual' },
    ]);
    expect(year.filter((h) => h.date === '2026-12-25')).toHaveLength(1);
  });

  it('lists holidays across a year boundary, and counts only real days off', () => {
    const between = holidaysBetween('2026-12-20', '2027-01-05');
    expect(between.map((h) => h.date)).toEqual([
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect([...dayOffSet('2026-12-20', '2027-01-05')]).toEqual([
      '2026-12-25',
      '2026-12-26',
      '2027-01-01',
    ]);
  });
});
