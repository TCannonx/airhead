// Copied from src/lib/leave/engine.ts (keep in step; Deno needs .ts import paths).
// scheduler-tick tests check the same balances as the app's leave tests.
import { addDays, weekday } from '../holidays/easter.ts';
import { dayOffSet, irishPublicHolidays } from '../holidays/ie.ts';
import { leaveTypeOf, type LeaveBooking, type WorkSettings } from './work.ts';

/**
 * Leave engine (Task 4.5): leave-year boundaries, working-day counting with
 * half days, balances, carry-over and its expiry, weekend-holiday compensation
 * and a pace figure. Pure functions over YYYY-MM-DD strings, so no time zone
 * can move a day.
 */
export interface LeaveYear {
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day, YYYY-MM-DD. */
  end: string;
}

/** Fields of a booking the engine needs (a full LeaveBooking also fits). */
export type BookingLike = Pick<
  LeaveBooking,
  'start_date' | 'end_date' | 'start_half' | 'end_half' | 'leave_type' | 'status'
> & { deleted_at?: string | null };

export interface Balance {
  year: LeaveYear;
  entitlement: number;
  /** Extra days for public holidays on non-working days (when compensated with leave). */
  extra_days: number;
  carry_over: number;
  /** When carried-over days expire (null = never). */
  carry_over_expires: string | null;
  /** Carried-over days lost because they were not used before expiry (so far). */
  carry_over_expired: number;
  /** Carried-over days still to use before they expire (0 once expired or used). */
  carry_over_at_risk: number;
  taken: number;
  /** Requested or approved, not yet taken. */
  booked: number;
  planned: number;
  /** Company closure days deducted from leave (included in taken/booked). */
  closure: number;
  /** entitlement + extra + carry-over − expired. */
  total: number;
  remaining: number;
  /** Share of the total already taken, and of the leave year gone (0–100). */
  pace: { used_pct: number; through_pct: number };
  /** Days that would be lost at year end: remaining beyond the carry-over allowance. */
  lose_at_year_end: number;
}

const mmdd = (d: string) => d.slice(5);
const yearOf = (d: string) => Number(d.slice(0, 4));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The leave year containing `date`. */
export function leaveYearFor(date: string, settings: WorkSettings): LeaveYear {
  const s = settings.leave_year_start;
  const startYear = mmdd(date) >= s ? yearOf(date) : yearOf(date) - 1;
  const start = `${startYear}-${s}`;
  return { start, end: addDays(`${startYear + 1}-${s}`, -1) };
}

/** Adds whole months to a YYYY-MM-DD date, clamping to the month's last day. */
export function addMonths(date: string, months: number): string {
  const y = yearOf(date);
  const m = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(date.slice(8, 10)), last);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function* eachDay(start: string, end: string) {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d;
}

/** Days off that never count as leave between two dates: holidays, manual one-offs, closures. */
function nonLeaveDays(start: string, end: string, settings: WorkSettings): Set<string> {
  const off = dayOffSet(start, end, settings.manual_holidays);
  for (const c of settings.closure_days) if (c >= start && c <= end) off.add(c);
  return off;
}

/** A day that would cost leave if booked: a working weekday that is not a holiday or closure. */
export function isLeaveDay(date: string, settings: WorkSettings, off?: Set<string>): boolean {
  if (!settings.working_days.includes(weekday(date))) return false;
  return !(off ?? nonLeaveDays(date, date, settings)).has(date);
}

/**
 * Working days a booking costs, optionally only the part inside [from, to].
 * Half days: the first day starts at midday and/or the last day ends at midday;
 * a one-day booking with either half is half a day.
 */
export function countLeaveDays(
  b: Pick<BookingLike, 'start_date' | 'end_date' | 'start_half' | 'end_half'>,
  settings: WorkSettings,
  from?: string,
  to?: string,
): number {
  const start = from && from > b.start_date ? from : b.start_date;
  const end = to && to < b.end_date ? to : b.end_date;
  if (end < start) return 0;
  const off = nonLeaveDays(start, end, settings);
  let total = 0;
  for (const d of eachDay(start, end)) {
    if (!isLeaveDay(d, settings, off)) continue;
    const single = b.start_date === b.end_date;
    const half =
      (single && (b.start_half || b.end_half)) ||
      (d === b.start_date && b.start_half) ||
      (d === b.end_date && b.end_half);
    total += half ? 0.5 : 1;
  }
  return total;
}

/** Statutory public holidays in the leave year that fall on a non-working day. */
export function holidaysOnDaysOff(year: LeaveYear, settings: WorkSettings): string[] {
  const out: string[] = [];
  for (let y = yearOf(year.start); y <= yearOf(year.end); y++) {
    for (const h of irishPublicHolidays(y)) {
      if (h.date < year.start || h.date > year.end) continue;
      if (!settings.working_days.includes(weekday(h.date))) out.push(h.date);
    }
  }
  return out;
}

type Bucket = 'taken' | 'booked' | 'planned';

function bucketOf(b: BookingLike, today: string): Bucket {
  if (b.status === 'taken') return 'taken';
  if (b.status === 'planned') return 'planned';
  // Requested/approved leave whose last day has passed counts as taken
  // even before the nightly job updates its status.
  return b.end_date < today ? 'taken' : 'booked';
}

function closureLeaveDays(year: LeaveYear, settings: WorkSettings): string[] {
  if (!settings.closure_uses_leave) return [];
  const holidays = dayOffSet(year.start, year.end, settings.manual_holidays);
  return settings.closure_days.filter(
    (d) =>
      d >= year.start &&
      d <= year.end &&
      settings.working_days.includes(weekday(d)) &&
      !holidays.has(d),
  );
}

/** Deducting leave (bookings + closures) inside [from, to]. */
function deductedBetween(
  bookings: BookingLike[],
  settings: WorkSettings,
  year: LeaveYear,
  from: string,
  to: string,
): number {
  let n = 0;
  for (const b of bookings) {
    if (b.deleted_at || !leaveTypeOf(settings, b.leave_type).deducts) continue;
    n += countLeaveDays(b, settings, from, to);
  }
  n += closureLeaveDays(year, settings).filter((d) => d >= from && d <= to).length;
  return n;
}

/** Days carried into a leave year: entered by hand, or worked out from the year before. */
export function carryOverInto(
  year: LeaveYear,
  bookings: BookingLike[],
  settings: WorkSettings,
  depth = 0,
): number {
  const manual = settings.opening_carry_over[year.start];
  if (manual !== undefined) return Math.min(manual, Math.max(manual, 0));
  if (depth >= 10) return 0;
  const prev = leaveYearFor(addDays(year.start, -1), settings);
  const hasHistory = bookings.some(
    (b) => !b.deleted_at && b.start_date <= prev.end && b.end_date >= prev.start,
  );
  if (!hasHistory && settings.opening_carry_over[prev.start] === undefined) return 0;
  const prevBalance = balanceFor(prev, bookings, settings, prev.end, depth + 1);
  return round1(Math.min(settings.carry_over_max, Math.max(0, prevBalance.remaining)));
}

/** The leave balance for a leave year, as of `today` (YYYY-MM-DD). */
export function balanceFor(
  year: LeaveYear,
  bookings: BookingLike[],
  settings: WorkSettings,
  today: string,
  depth = 0,
): Balance {
  const extra =
    settings.weekend_holiday === 'extra_leave' ? holidaysOnDaysOff(year, settings).length : 0;
  const carry = carryOverInto(year, bookings, settings, depth);

  const sums: Record<Bucket, number> = { taken: 0, booked: 0, planned: 0 };
  for (const b of bookings) {
    if (b.deleted_at || !leaveTypeOf(settings, b.leave_type).deducts) continue;
    sums[bucketOf(b, today)] += countLeaveDays(b, settings, year.start, year.end);
  }
  const closures = closureLeaveDays(year, settings);
  for (const d of closures) sums[d < today ? 'taken' : 'booked'] += 1;

  // Carried-over days are used first; any not used before expiry are lost.
  const expires =
    carry > 0 && settings.carry_over_expiry_months !== null
      ? addMonths(year.start, settings.carry_over_expiry_months)
      : null;
  let expired = 0;
  let atRisk = 0;
  if (expires) {
    const usedBefore = deductedBetween(bookings, settings, year, year.start, addDays(expires, -1));
    const unused = Math.max(0, carry - usedBefore);
    if (today >= expires) expired = unused;
    else atRisk = unused;
  }

  const total = settings.entitlement + extra + carry - expired;
  const used = sums.taken + sums.booked + sums.planned;
  const remaining = total - used;
  const yearDays = (Date.parse(year.end) - Date.parse(year.start)) / 86_400_000 + 1;
  const gone = Math.min(
    Math.max((Date.parse(today) - Date.parse(year.start)) / 86_400_000 + 1, 0),
    yearDays,
  );

  return {
    year,
    entitlement: settings.entitlement,
    extra_days: extra,
    carry_over: carry,
    carry_over_expires: expires,
    carry_over_expired: round1(expired),
    carry_over_at_risk: round1(atRisk),
    taken: round1(sums.taken),
    booked: round1(sums.booked),
    planned: round1(sums.planned),
    closure: closures.length,
    total: round1(total),
    remaining: round1(remaining),
    pace: {
      used_pct: total > 0 ? Math.round((sums.taken / total) * 100) : 0,
      through_pct: Math.round((gone / yearDays) * 100),
    },
    lose_at_year_end: round1(Math.max(0, remaining - settings.carry_over_max)),
  };
}

/** Convenience: the balance of the leave year containing today. */
export function currentBalance(
  bookings: BookingLike[],
  settings: WorkSettings,
  today: string,
): Balance {
  return balanceFor(leaveYearFor(today, settings), bookings, settings, today);
}

/** The pace line, e.g. "30% used, 70% through the year". */
export function paceText(b: Balance): string {
  return `${b.pace.used_pct}% used, ${b.pace.through_pct}% through the year`;
}
