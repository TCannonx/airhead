import { addDays } from '../holidays/easter';
import { dayOffSet } from '../holidays/ie';
import type { ExternalEvent, Item, LeaveBooking } from '../schemas/records';
import type { WorkSettings } from '../work/settings';
import { findBridges, type Bridge, type BridgeInput } from './bridges';
import { currentBalance } from './engine';

/**
 * Leave suggestions (Task 8.8): the bridge finder's inputs come from the
 * device's own data (holidays, the work pattern, bookings, events, the linked
 * calendar and the balance), so candidates show at once, even offline. The
 * optional AI step only picks and words two or three of them.
 */
const dates = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};
const localDate = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface LeaveData {
  work: WorkSettings;
  bookings: LeaveBooking[];
  events: Item[];
  external: ExternalEvent[];
  today: string;
  /** How far ahead to look, in weeks (default 26). */
  weeks?: number;
}

export function bridgeInput(d: LeaveData): BridgeInput {
  const from = addDays(d.today, 1);
  const to = addDays(d.today, (d.weeks ?? 26) * 7);
  const daysOff = dayOffSet(from, to, d.work.manual_holidays);
  if (!d.work.closure_uses_leave) for (const c of d.work.closure_days) daysOff.add(c);
  const booked = new Set<string>();
  for (const b of d.bookings)
    if (!b.deleted_at) for (const x of dates(b.start_date, b.end_date)) booked.add(x);
  const busy = new Set<string>();
  for (const e of d.events)
    if (!e.deleted_at && e.type === 'event' && e.status === 'open' && e.start_at)
      busy.add(localDate(e.start_at));
  for (const e of d.external) if (!e.deleted_at) busy.add(localDate(e.start_at));
  const balance = currentBalance(d.bookings, d.work, d.today).remaining;
  return { from, to, workingDays: d.work.working_days, daysOff, booked, busy, balance };
}

export const leaveBridges = (d: LeaveData, limit = 8): Bridge[] =>
  findBridges(bridgeInput(d), limit);

/** What the AI gets besides the candidates: occasions, the last break, busy weeks. */
export function leaveContext(d: LeaveData): {
  occasions: { date: string; title: string }[];
  days_since_break: number | null;
  busy_weeks: { week: string; events: number }[];
} {
  const to = addDays(d.today, (d.weeks ?? 26) * 7);
  const occasions = d.events
    .filter((e) => !e.deleted_at && e.type === 'event' && e.start_at)
    .map((e) => ({ date: localDate(e.start_at as string), title: e.title.slice(0, 80) }))
    .filter((e) => e.date > d.today && e.date <= to)
    .filter((e) =>
      /birthday|anniversary|wedding|holiday|trip|festival|concert|match/i.test(e.title),
    )
    .slice(0, 12);
  const lastBreak = d.bookings
    .filter((b) => !b.deleted_at && b.end_date <= d.today && (b.days ?? 0) >= 3)
    .map((b) => b.end_date)
    .sort()
    .at(-1);
  const days_since_break = lastBreak
    ? Math.round((Date.parse(d.today) - Date.parse(lastBreak)) / 86_400_000)
    : null;
  const weeks = new Map<string, number>();
  for (const e of [...d.events.filter((x) => x.type === 'event'), ...d.external]) {
    if (e.deleted_at || !e.start_at) continue;
    const day = localDate(e.start_at);
    if (day <= d.today || day > to) continue;
    const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = addDays(day, -dow);
    weeks.set(monday, (weeks.get(monday) ?? 0) + 1);
  }
  const busy_weeks = [...weeks]
    .map(([week, events]) => ({ week, events }))
    .filter((w) => w.events >= 5)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(0, 10);
  return { occasions, days_since_break, busy_weeks };
}
