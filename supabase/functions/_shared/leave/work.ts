/**
 * Work settings for server code: the same fields and defaults as the app's
 * src/lib/work/settings.ts (keep in step), read without Zod. Invalid fields
 * fall back to their defaults one by one, like the app.
 */
export type WorkLocation = 'wfh' | 'office' | 'client' | 'travel' | 'off';

export interface LeaveType {
  key: string;
  name: string;
  deducts: boolean;
}

export interface WorkSettings {
  working_days: number[];
  hours_per_day: number;
  leave_year_start: string;
  entitlement: number;
  carry_over_max: number;
  carry_over_expiry_months: number | null;
  opening_carry_over: Record<string, number>;
  weekend_holiday: 'day_off' | 'extra_leave' | 'extra_pay';
  closure_uses_leave: boolean;
  closure_days: string[];
  manual_holidays: { date: string; name: string }[];
  leave_types: LeaveType[];
  location_pattern: Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', WorkLocation>>;
  checklists: Partial<Record<WorkLocation, string[]>>;
  location_sharing: 'full' | 'working' | 'none';
}

export interface LeaveBooking {
  start_date: string;
  end_date: string;
  start_half: boolean;
  end_half: boolean;
  leave_type: string;
  status: 'planned' | 'requested' | 'approved' | 'taken';
}

export const DEFAULT_WORK: WorkSettings = {
  working_days: [1, 2, 3, 4, 5],
  hours_per_day: 7.5,
  leave_year_start: '12-01',
  entitlement: 21,
  carry_over_max: 5,
  carry_over_expiry_months: 3,
  opening_carry_over: {},
  weekend_holiday: 'day_off',
  closure_uses_leave: false,
  closure_days: [],
  manual_holidays: [],
  leave_types: [
    { key: 'annual', name: 'Annual leave', deducts: true },
    { key: 'sick', name: 'Sick leave', deducts: false },
    { key: 'other', name: 'Other (not deducted)', deducts: false },
  ],
  location_pattern: { '1': 'office', '2': 'office', '3': 'wfh', '4': 'office', '5': 'wfh' },
  checklists: { office: ['Laptop', 'Charger', 'Pass'] },
  location_sharing: 'full',
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min: number, max: number) => typeof v === 'number' && v >= min && v <= max;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readWork(settingsData: Record<string, unknown> | null | undefined): WorkSettings {
  const w = isObj(settingsData?.work) ? settingsData.work : {};
  const out: WorkSettings = { ...DEFAULT_WORK };
  if (
    Array.isArray(w.working_days) &&
    w.working_days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )
    out.working_days = w.working_days as number[];
  if (num(w.hours_per_day, 0.01, 24)) out.hours_per_day = w.hours_per_day as number;
  if (
    typeof w.leave_year_start === 'string' &&
    /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(w.leave_year_start)
  )
    out.leave_year_start = w.leave_year_start;
  if (num(w.entitlement, 0, 100)) out.entitlement = w.entitlement as number;
  if (num(w.carry_over_max, 0, 100)) out.carry_over_max = w.carry_over_max as number;
  if (
    w.carry_over_expiry_months === null ||
    (Number.isInteger(w.carry_over_expiry_months) && num(w.carry_over_expiry_months, 1, 12))
  )
    out.carry_over_expiry_months = w.carry_over_expiry_months as number | null;
  if (isObj(w.opening_carry_over))
    out.opening_carry_over = Object.fromEntries(
      Object.entries(w.opening_carry_over).filter(([k, v]) => DATE.test(k) && num(v, 0, 1000)),
    ) as Record<string, number>;
  if (['day_off', 'extra_leave', 'extra_pay'].includes(w.weekend_holiday as string))
    out.weekend_holiday = w.weekend_holiday as WorkSettings['weekend_holiday'];
  if (typeof w.closure_uses_leave === 'boolean') out.closure_uses_leave = w.closure_uses_leave;
  if (Array.isArray(w.closure_days))
    out.closure_days = w.closure_days.filter((d) => typeof d === 'string' && DATE.test(d));
  if (Array.isArray(w.manual_holidays))
    out.manual_holidays = w.manual_holidays.filter(
      (h): h is { date: string; name: string } =>
        isObj(h) && DATE.test(String(h.date)) && typeof h.name === 'string',
    );
  if (Array.isArray(w.leave_types) && w.leave_types.length)
    out.leave_types = w.leave_types.filter(
      (t): t is LeaveType =>
        isObj(t) &&
        typeof t.key === 'string' &&
        typeof t.name === 'string' &&
        typeof t.deducts === 'boolean',
    );
  if (isObj(w.location_pattern))
    out.location_pattern = w.location_pattern as WorkSettings['location_pattern'];
  if (isObj(w.checklists)) out.checklists = w.checklists as WorkSettings['checklists'];
  if (['full', 'working', 'none'].includes(w.location_sharing as string))
    out.location_sharing = w.location_sharing as WorkSettings['location_sharing'];
  return out;
}

export function leaveTypeOf(settings: WorkSettings, key: string): LeaveType {
  return (
    settings.leave_types.find((t) => t.key === key) ?? { key, name: key, deducts: key === 'annual' }
  );
}

export function patternLocation(settings: WorkSettings, weekday: number): WorkLocation {
  if (!settings.working_days.includes(weekday)) return 'off';
  return settings.location_pattern[String(weekday) as '0'] ?? 'office';
}
