import { describe, expect, it } from 'vitest';
import type { SettingsRow } from '../schemas/records';
import { DEFAULT_WORK_SETTINGS, leaveTypeOf, patternLocation, readWorkSettings } from './settings';

const row = (work: unknown): SettingsRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  user_id: '22222222-2222-4222-8222-222222222222',
  created_at: '2026-07-01T09:00:00Z',
  updated_at: '2026-07-01T09:00:00Z',
  server_updated_at: null,
  deleted_at: null,
  data: { work },
});

describe('work settings', () => {
  it('defaults: Mon–Fri, 7.5 h, leave year from 1 December, weekend holiday = day off', () => {
    expect(readWorkSettings(undefined)).toEqual(DEFAULT_WORK_SETTINGS);
    expect(DEFAULT_WORK_SETTINGS.working_days).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_WORK_SETTINGS.hours_per_day).toBe(7.5);
    expect(DEFAULT_WORK_SETTINGS.leave_year_start).toBe('12-01');
    expect(DEFAULT_WORK_SETTINGS.weekend_holiday).toBe('day_off');
    expect(DEFAULT_WORK_SETTINGS.leave_types.map((t) => t.key)).toContain('annual');
  });

  it('fills missing fields from the defaults', () => {
    const s = readWorkSettings(row({ entitlement: 25 }));
    expect(s.entitlement).toBe(25);
    expect(s.carry_over_max).toBe(DEFAULT_WORK_SETTINGS.carry_over_max);
  });

  it('keeps valid fields when another is invalid', () => {
    const s = readWorkSettings(
      row({ entitlement: 25, leave_year_start: '13-40', hours_per_day: -1 }),
    );
    expect(s.entitlement).toBe(25);
    expect(s.leave_year_start).toBe('12-01');
    expect(s.hours_per_day).toBe(7.5);
  });

  it('finds leave types, treating an unknown one as non-deducting unless it is annual', () => {
    expect(leaveTypeOf(DEFAULT_WORK_SETTINGS, 'sick').deducts).toBe(false);
    expect(leaveTypeOf(DEFAULT_WORK_SETTINGS, 'annual').deducts).toBe(true);
    expect(leaveTypeOf(DEFAULT_WORK_SETTINGS, 'unknown').deducts).toBe(false);
  });

  it('reads the weekly location pattern; non-working days are Off', () => {
    expect(patternLocation(DEFAULT_WORK_SETTINGS, 1)).toBe('office');
    expect(patternLocation(DEFAULT_WORK_SETTINGS, 3)).toBe('wfh');
    expect(patternLocation(DEFAULT_WORK_SETTINGS, 6)).toBe('off');
  });
});
