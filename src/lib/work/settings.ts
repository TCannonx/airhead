import { z } from 'zod';
import { WORK_LOCATIONS, type SettingsRow, type WorkLocation } from '../schemas/records';

/**
 * Work and leave settings, kept in settings.data.work (synced with the rest of
 * the settings row). Every field has a default, so a partial or older object
 * always reads as a complete one.
 */
const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const isoDate = z.iso.date();

/** A standing prep reminder before matching events (the database makes the nudges). */
export const prepRuleSchema = z.object({
  id: z.string().min(1),
  match: z.array(z.string().min(2).max(40)).min(1).max(5),
  reminder: z.string().min(1).max(120),
  minutes_before: z.number().int().min(0).max(10080),
});
export type PrepRule = z.infer<typeof prepRuleSchema>;

/** The rules whose words appear in an event title (same test as the database). */
export function prepRulesFor(title: string, rules: PrepRule[]): PrepRule[] {
  const t = title.toLowerCase();
  return rules.filter((r) =>
    r.match.some((w) => w.trim().length >= 2 && t.includes(w.trim().toLowerCase())),
  );
}

/** "12 h before", "1 day before", "30 min before". */
export function beforeText(minutes: number): string {
  if (minutes === 0) return 'at the start';
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`;
  if (minutes % 60 === 0) return `${minutes / 60} h before`;
  return `${minutes} min before`;
}

export const WEEKEND_HOLIDAY_RULES = ['day_off', 'extra_leave', 'extra_pay'] as const;
export const LOCATION_SHARING = ['full', 'working', 'none'] as const;

export const leaveTypeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** Deducts from the annual entitlement (annual leave) or not (sick, compassionate, ...). */
  deducts: z.boolean(),
});
export type LeaveType = z.infer<typeof leaveTypeSchema>;

export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { key: 'annual', name: 'Annual leave', deducts: true },
  { key: 'sick', name: 'Sick leave', deducts: false },
  { key: 'other', name: 'Other (not deducted)', deducts: false },
];

export const LOCATION_LABELS: Record<WorkLocation, string> = {
  wfh: 'WFH',
  office: 'Office',
  client: 'Client site',
  travel: 'Travel',
  off: 'Off',
};

const location = z.enum(WORK_LOCATIONS);

export const workSettingsSchema = z.object({
  /** Working weekdays, 0 = Sunday … 6 = Saturday. */
  working_days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  hours_per_day: z.number().positive().max(24).default(7.5),
  /** Leave year start as MM-DD (default 1 December, so the year runs to 30 November). */
  leave_year_start: monthDay.default('12-01'),
  /** Annual entitlement in days. */
  entitlement: z.number().min(0).max(100).default(21),
  /** Most days that carry over into the next leave year. */
  carry_over_max: z.number().min(0).max(100).default(5),
  /** Carried-over days expire this many months into the new year (null = never). */
  carry_over_expiry_months: z.number().int().min(1).max(12).nullable().default(3),
  /**
   * Carry-over entered by hand for a leave year (key = the year's start date),
   * e.g. for the first year Airhead is used. Otherwise it is worked out from
   * the previous year's bookings.
   */
  opening_carry_over: z.record(isoDate, z.number().min(0)).default({}),
  /** Days used before Airhead, per leave-year start (counted as taken). */
  opening_used: z.record(isoDate, z.number().min(0).max(366)).default({}),
  /** "Before a barber appointment: bring €20 cash" (Phase 10 follow-up). */
  prep_rules: z.array(prepRuleSchema).max(30).default([]),
  /** What the employer gives for a public holiday on a non-working day. */
  weekend_holiday: z.enum(WEEKEND_HOLIDAY_RULES).default('day_off'),
  /** Company closure days come out of annual leave. */
  closure_uses_leave: z.boolean().default(false),
  closure_days: z.array(isoDate).default([]),
  manual_holidays: z.array(z.object({ date: isoDate, name: z.string().min(1) })).default([]),
  leave_types: z.array(leaveTypeSchema).min(1).default(DEFAULT_LEAVE_TYPES),
  /** Default location per weekday ('0'..'6'); non-working days are always Off. */
  location_pattern: z
    .partialRecord(z.enum(['0', '1', '2', '3', '4', '5', '6']), location)
    .default({ '1': 'office', '2': 'office', '3': 'wfh', '4': 'office', '5': 'wfh' }),
  /** Things to bring, per location, sent the evening before. */
  checklists: z
    .partialRecord(location, z.array(z.string()))
    .default({ office: ['Laptop', 'Charger', 'Pass'] }),
  /** How each day's location shows on the Us feed. */
  location_sharing: z.enum(LOCATION_SHARING).default('full'),
});
export type WorkSettings = z.infer<typeof workSettingsSchema>;

export const DEFAULT_WORK_SETTINGS: WorkSettings = workSettingsSchema.parse({});

/** Reads settings.data.work; anything invalid falls back to its default, field by field. */
export function readWorkSettings(settings: SettingsRow | undefined | null): WorkSettings {
  const raw = settings?.data?.work;
  if (!raw || typeof raw !== 'object') return DEFAULT_WORK_SETTINGS;
  const whole = workSettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const out: Record<string, unknown> = { ...DEFAULT_WORK_SETTINGS };
  const shape = workSettingsSchema.shape;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in shape)) continue;
    const field = shape[key as keyof typeof shape].safeParse(value);
    if (field.success) out[key] = field.data;
  }
  return out as WorkSettings;
}

export function leaveTypeOf(settings: WorkSettings, key: string): LeaveType {
  return (
    settings.leave_types.find((t) => t.key === key) ?? { key, name: key, deducts: key === 'annual' }
  );
}

/** The default location for a date from the weekly pattern (Off on non-working days). */
export function patternLocation(settings: WorkSettings, weekday: number): WorkLocation {
  if (!settings.working_days.includes(weekday)) return 'off';
  return settings.location_pattern[String(weekday) as '0'] ?? 'office';
}
