import { addDays } from '../_shared/holidays/easter.ts';
import { balanceFor, countLeaveDays, leaveYearFor } from '../_shared/leave/engine.ts';
import { leaveTypeOf, readWork, type WorkSettings } from '../_shared/leave/work.ts';
import type { SortActionT } from '../_shared/schemas/sort.ts';
import type { Candidate } from './candidates.ts';

/**
 * AI actions (Phase 10): the model suggests, these rules decide. Each action is
 * checked against the person's own data and comes out `applied` (clear, safe,
 * done straight away with Undo), `proposed` (needs a tap, with a plain reason)
 * or `skipped` (it would change nothing). `before` and `after` hold the exact
 * values so a device can undo or apply it later.
 */

export const ACTION_CONFIDENT = 0.8;
export const MAX_ACTIONS = 5;
const MAX_BOOKING_DAYS = 60;

export interface BookingRow {
  id: string;
  start_date: string;
  end_date: string;
  start_half: boolean;
  end_half: boolean;
  leave_type: string;
  status: 'planned' | 'requested' | 'approved' | 'taken';
  deleted_at: string | null;
}

export interface ItemRow {
  id: string;
  type: string;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  due_at: string | null;
  data: Record<string, unknown>;
  updated_at: string;
}

export interface ActionContext {
  userId: string;
  now: Date;
  /** Today in the person's time zone, YYYY-MM-DD. */
  today: string;
  timeZone: string;
  /** settings.data.work exactly as stored (may be {}). */
  workRaw: Record<string, unknown>;
  bookings: BookingRow[];
  candidates: Candidate[];
  /** Full rows of the candidates, by id. */
  items: Map<string, ItemRow>;
}

/** An item created by this batch (a reminder may be set on it). */
export interface NewItemRef {
  id: string;
  type: string;
  start_at: string | null;
  all_day: boolean;
  due_at: string | null;
  data: Record<string, unknown>;
}

export type TargetTable = 'settings' | 'leave_bookings' | 'items';

export interface PlannedAction {
  id: string;
  /** Null for an action found in a note (then note_id is set; Task 11.0). */
  capture_id: string | null;
  note_id?: string;
  kind: SortActionT['kind'];
  status: 'applied' | 'proposed' | 'skipped';
  reason: string | null;
  summary: string;
  quote: string;
  confidence: number;
  payload: Record<string, unknown>;
  target_table: TargetTable | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

type Target = Pick<PlannedAction, 'target_table' | 'target_id' | 'before' | 'after'>;
type Base = Pick<PlannedAction, 'id' | 'capture_id' | 'kind' | 'quote' | 'confidence' | 'payload'>;

const NO_TARGET: Target = { target_table: null, target_id: null, before: null, after: null };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const LOCATIONS = ['wfh', 'office', 'client', 'travel', 'off'];
const LOCATION_LABEL: Record<string, string> = {
  wfh: 'WFH',
  office: 'office',
  client: 'client site',
  travel: 'travel',
  off: 'off',
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round1 = (n: number) => Math.round(n * 10) / 10;
const isHalfStep = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isInteger(n * 2);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const validDate = (d: string | null | undefined): d is string =>
  !!d && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const iso = (v: string | null | undefined) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;

/** "22 Dec", "22–24 Dec", "30 Dec – 2 Jan". */
export function dateRange(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  if (start === end) return `${sd} ${MONTHS[sm - 1]}`;
  if (sm === em) return `${sd}–${ed} ${MONTHS[em - 1]}`;
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
}

/** "Thu 12 Nov, 16:00" (or without the time for all-day), in the person's zone. */
export function when(at: string, allDay: boolean, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('weekday')} ${get('day')} ${get('month')}`;
  return allDay ? date : `${date}, ${get('hour')}:${get('minute')}`;
}

/** The local date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

function minutesText(m: number): string {
  if (m === 0) return 'at the start';
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`;
  return `${m} min before`;
}

function result(
  b: Base,
  status: PlannedAction['status'],
  reason: string | null,
  summary: string,
  target: Target = NO_TARGET,
): PlannedAction {
  return { ...b, ...target, status, reason, summary };
}

/** Applied when sure enough; otherwise a proposal that still carries `after` for one tap. */
function decide(b: Base, summary: string, target: Target): PlannedAction {
  if (b.confidence < ACTION_CONFIDENT)
    return result(b, 'proposed', 'Not sure enough to do this by itself', summary, target);
  return result(b, 'applied', null, summary, target);
}

// Leave balance -------------------------------------------------------------------

function leaveBalance(b: Base, a: SortActionT, ctx: ActionContext, work: WorkSettings) {
  const remaining = a.kind === 'set_leave_remaining';
  const summary = remaining
    ? `Leave left set to ${days(a.days ?? 0)}`
    : `Leave used set to ${days(a.days ?? 0)}`;
  if (!isHalfStep(a.days))
    return result(b, 'proposed', 'That number of days doesn’t look right', summary);
  const type = leaveTypeOf(work, a.leave_type ?? 'annual');
  if (!type.deducts)
    return result(b, 'proposed', `${type.name} isn’t counted against your allowance`, summary);
  const asOf = a.as_of ?? ctx.today;
  const year = leaveYearFor(ctx.today, work);
  if (!validDate(asOf) || asOf < year.start || asOf > year.end)
    return result(b, 'proposed', 'That date isn’t in this leave year', summary);
  if (!('entitlement' in ctx.workRaw))
    return result(b, 'proposed', 'Set your yearly entitlement first (Settings → Work)', summary);

  const usedInApp = ctx.bookings
    .filter((x) => !x.deleted_at && x.end_date <= asOf && leaveTypeOf(work, x.leave_type).deducts)
    .reduce((n, x) => n + countLeaveDays(x, work, year.start, year.end), 0);
  const total = balanceFor(year, ctx.bookings, { ...work, opening_used: {} }, ctx.today).total;
  if (a.days > total)
    return result(b, 'proposed', `More than your yearly total (${days(total)})`, summary);
  const opening = round1(remaining ? total - usedInApp - a.days : a.days - usedInApp);
  if (opening < 0)
    return result(b, 'proposed', 'Airhead already has more leave recorded than that', summary);

  const current = (ctx.workRaw.opening_used ?? null) as Record<string, number> | null;
  const target: Target = {
    target_table: 'settings',
    target_id: ctx.userId,
    before: { opening_used: current },
    after: { opening_used: { ...(current ?? {}), [year.start]: opening } },
  };
  if (same(current?.[year.start] ?? 0, opening)) return result(b, 'skipped', null, summary, target);
  return decide(b, summary, target);
}

// Leave bookings -----------------------------------------------------------------------

function bookLeave(b: Base, a: SortActionT, ctx: ActionContext, work: WorkSettings) {
  const start = a.start_date;
  const end = a.end_date ?? a.start_date;
  const label = validDate(start) && validDate(end) ? dateRange(start, end) : 'those dates';
  const summary = `Leave booked: ${label}`;
  if (!validDate(start) || !validDate(end) || end < start)
    return result(b, 'proposed', 'Those dates don’t look right', summary);
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 > MAX_BOOKING_DAYS)
    return result(b, 'proposed', 'That’s longer than 60 days; book it by hand', summary);
  const current = leaveYearFor(ctx.today, work);
  const next = leaveYearFor(addDays(current.end, 1), work);
  if (start < current.start || end > next.end)
    return result(b, 'proposed', 'Only this leave year and the next can be booked', summary);
  const key = a.leave_type ?? 'annual';
  if (!work.leave_types.some((t) => t.key === key))
    return result(b, 'proposed', `There’s no “${key}” leave type yet (Settings → Work)`, summary);
  const clash = ctx.bookings.find(
    (x) => !x.deleted_at && x.start_date <= end && x.end_date >= start,
  );
  if (clash) {
    const day = clash.start_date > start ? clash.start_date : start;
    return result(b, 'proposed', `Overlaps leave on ${dateRange(day, day)}`, summary);
  }
  const booking = {
    start_date: start,
    end_date: end,
    start_half: a.start_half ?? false,
    end_half: a.end_half ?? false,
  };
  const cost = countLeaveDays(booking, work);
  if (cost === 0) return result(b, 'proposed', 'No working days in those dates', summary);
  const status = end < ctx.today ? 'taken' : (a.leave_status ?? 'planned');
  const typeName = leaveTypeOf(work, key).name;
  return decide(b, `${typeName} booked: ${label} (${days(cost)})`, {
    target_table: 'leave_bookings',
    target_id: crypto.randomUUID(),
    before: null,
    after: { ...booking, leave_type: key, status, days: cost },
  });
}

// Work settings --------------------------------------------------------------------------

function parseSetting(
  setting: NonNullable<SortActionT['setting']>,
  raw: string | null,
  work: WorkSettings,
): { value: unknown; summary: string } | null {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? '');
  } catch {
    // A bare 12-01 for the leave year start.
    v = raw?.trim();
  }
  switch (setting) {
    case 'entitlement':
    case 'carry_over_max':
      if (!isHalfStep(v) || v > 100) return null;
      return {
        value: v,
        summary:
          setting === 'entitlement'
            ? `Entitlement set to ${days(v)}`
            : `Carry-over limit set to ${days(v)}`,
      };
    case 'leave_year_start': {
      if (typeof v !== 'string' || !MMDD.test(v)) return null;
      const [m, d] = v.split('-').map(Number);
      return { value: v, summary: `Leave year now starts ${d} ${MONTHS[m - 1]}` };
    }
    case 'working_days': {
      if (
        !Array.isArray(v) ||
        v.length === 0 ||
        !v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      )
        return null;
      const list = [...new Set(v as number[])].sort((x, y) => x - y);
      return {
        value: list,
        summary: `Working days set to ${list.map((d) => DAY_NAMES[d]).join(', ')}`,
      };
    }
    case 'location_pattern': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const entries = Object.entries(v as Record<string, unknown>);
      if (
        entries.length === 0 ||
        !entries.every(([k, l]) => /^[0-6]$/.test(k) && LOCATIONS.includes(l as string))
      )
        return null;
      return {
        value: { ...work.location_pattern, ...(v as Record<string, string>) },
        summary: `Usual week: ${entries
          .sort(([x], [y]) => Number(x) - Number(y))
          .map(([k, l]) => `${DAY_NAMES[Number(k)]} ${LOCATION_LABEL[l as string]}`)
          .join(', ')}`,
      };
    }
  }
}

function workSetting(b: Base, a: SortActionT, ctx: ActionContext, work: WorkSettings) {
  if (!a.setting) return result(b, 'proposed', 'That setting value doesn’t look right', 'Setting');
  const parsed = parseSetting(a.setting, a.value, work);
  if (!parsed)
    return result(b, 'proposed', 'That setting value doesn’t look right', `Change ${a.setting}`);
  const target: Target = {
    target_table: 'settings',
    target_id: ctx.userId,
    before: { [a.setting]: ctx.workRaw[a.setting] ?? null },
    after: { [a.setting]: parsed.value },
  };
  if (same(work[a.setting], parsed.value))
    return result(b, 'skipped', null, parsed.summary, target);
  return decide(b, parsed.summary, target);
}

// Reminders ----------------------------------------------------------------------------------

function reminder(
  b: Base,
  a: SortActionT,
  ctx: ActionContext,
  newItems: (NewItemRef | undefined)[],
) {
  const fresh =
    a.target_item_index !== null && a.target_item_index >= 0
      ? newItems[a.target_item_index]
      : undefined;
  const existing = !fresh && a.target_id ? ctx.items.get(a.target_id) : undefined;
  const item = fresh ?? existing;
  const summary =
    a.offset_minutes !== null ? `Reminder set: ${minutesText(a.offset_minutes)}` : 'Reminder set';
  if (!item || (existing && !ctx.candidates.some((c) => c.id === existing.id)))
    return result(b, 'proposed', 'Couldn’t tell which item the reminder is for', summary);
  const stamp = existing ? { updated_at: existing.updated_at } : {};

  if (item.type === 'event') {
    const m = a.offset_minutes;
    if (m === null || !Number.isInteger(m) || m < 0 || m > 1440)
      return result(b, 'proposed', 'Reminders can be up to a day before', summary);
    if (item.all_day || !item.start_at)
      return result(b, 'proposed', 'All-day events don’t have a reminder time', summary);
    const data = { ...item.data, reminder_minutes: String(m) };
    const target: Target = {
      target_table: 'items',
      target_id: item.id,
      before: { data: item.data, ...stamp },
      after: { data },
    };
    if (same(item.data.reminder_minutes, String(m)))
      return result(b, 'skipped', null, summary, target);
    const out = decide(b, summary, target);
    if (out.status === 'applied' && fresh) fresh.data = data;
    return out;
  }

  if (item.type === 'task') {
    const at = iso(a.remind_at);
    if (!at || Date.parse(at) <= ctx.now.getTime())
      return result(b, 'proposed', 'That reminder time doesn’t look right', summary);
    if (item.due_at && !same(iso(item.due_at), at))
      return result(b, 'proposed', 'This task already has a due time', summary);
    const label = `Reminder set for ${when(at, false, ctx.timeZone)}`;
    const target: Target = {
      target_table: 'items',
      target_id: item.id,
      before: { due_at: item.due_at, ...stamp },
      after: { due_at: at },
    };
    if (same(iso(item.due_at), at)) return result(b, 'skipped', null, label, target);
    const out = decide(b, label, target);
    if (out.status === 'applied' && fresh) fresh.due_at = at;
    return out;
  }
  return result(b, 'proposed', 'Reminders are for events and tasks', summary);
}

// Moving existing items --------------------------------------------------------------------------

function reschedule(b: Base, a: SortActionT, ctx: ActionContext) {
  const cand = a.target_id ? ctx.candidates.find((c) => c.id === a.target_id) : undefined;
  const item = cand ? ctx.items.get(cand.id) : undefined;
  if (!cand || !item)
    return result(
      { ...b, payload: { ...b.payload, choices: [] } },
      'proposed',
      'Couldn’t tell which item to move',
      'Move an item',
    );
  const others = a.other_matches.filter(
    (id) => id !== cand.id && ctx.candidates.some((c) => c.id === id),
  );
  const title = cand.title;
  if (others.length)
    return result(
      { ...b, payload: { ...b.payload, choices: [cand.id, ...others] } },
      'proposed',
      'Which one?',
      `Move “${title}”`,
    );
  if (cand.repeats)
    return result(b, 'proposed', 'This repeats; change one or all?', `Move “${title}”`);

  if (item.type === 'task') {
    const due = iso(a.due_at ?? a.start_at);
    if (!due || Date.parse(due) <= ctx.now.getTime())
      return result(b, 'proposed', 'The new time doesn’t look right', `Move “${title}”`);
    const summary = `Moved “${title}” to ${when(due, false, ctx.timeZone)}`;
    const target: Target = {
      target_table: 'items',
      target_id: item.id,
      before: { due_at: item.due_at, updated_at: item.updated_at },
      after: { due_at: due },
    };
    if (same(iso(item.due_at), due)) return result(b, 'skipped', null, summary, target);
    return decide(b, summary, target);
  }

  const start = iso(a.start_at);
  const allDay = a.all_day ?? item.all_day;
  const ok =
    !!start &&
    (allDay ? localDate(start, ctx.timeZone) >= ctx.today : Date.parse(start) > ctx.now.getTime());
  if (!ok || !start)
    return result(b, 'proposed', 'The new time doesn’t look right', `Move “${title}”`);
  let end = iso(a.end_at);
  if (!end && item.end_at && item.start_at) {
    const length = Date.parse(item.end_at) - Date.parse(item.start_at);
    end = new Date(Date.parse(start) + length).toISOString();
  }
  const summary = `Moved “${title}” to ${when(start, allDay, ctx.timeZone)}`;
  const target: Target = {
    target_table: 'items',
    target_id: item.id,
    before: {
      start_at: item.start_at,
      end_at: item.end_at,
      all_day: item.all_day,
      updated_at: item.updated_at,
    },
    after: { start_at: start, end_at: end, all_day: allDay },
  };
  if (same(iso(item.start_at), start) && same(iso(item.end_at), end) && item.all_day === allDay)
    return result(b, 'skipped', null, summary, target);
  return decide(b, summary, target);
}

// Standing prep rules -----------------------------------------------------------

function prepRule(b: Base, a: SortActionT, ctx: ActionContext, work: WorkSettings) {
  const words = [
    ...new Set(
      (a.match ?? [])
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 2 && w.length <= 40),
    ),
  ].slice(0, 5);
  const reminder = (a.reminder ?? '').trim().slice(0, 120);
  const minutes = a.minutes_before ?? 720;
  const quoted = words.map((w) => `“${w}”`).join(' or ');
  const summary = `Prep reminder: “${reminder}” before ${quoted || 'matching'} events`;
  if (!words.length || !reminder)
    return result(b, 'proposed', 'Which events, and what to remind?', summary);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080)
    return result(b, 'proposed', 'Prep reminders can be up to a week before', summary);
  const current = Array.isArray(ctx.workRaw.prep_rules)
    ? (ctx.workRaw.prep_rules as Record<string, unknown>[])
    : null;
  const rule = {
    id: crypto.randomUUID().slice(0, 8),
    match: words,
    reminder,
    minutes_before: minutes,
  };
  const target: Target = {
    target_table: 'settings',
    target_id: ctx.userId,
    before: { prep_rules: current },
    after: { prep_rules: [...(current ?? []), rule] },
  };
  const same = work.prep_rules.some(
    (r) =>
      r.reminder.toLowerCase() === reminder.toLowerCase() &&
      [...r.match]
        .map((w) => w.toLowerCase())
        .sort()
        .join('|') === [...words].sort().join('|'),
  );
  if (same) return result(b, 'skipped', null, summary, target);
  return decide(b, summary, target);
}

// Entry point --------------------------------------------------------------------------------------

/**
 * Checks a capture's actions (at most 5). `newItems` are this capture's own items in
 * the model's order (undefined where an item was not kept), so target_item_index
 * points at the right one; a tidied instant event is its existing item (Task 11.0).
 */
export function planActions(
  captureId: string,
  actions: SortActionT[],
  newItems: (NewItemRef | undefined)[],
  ctx: ActionContext,
): PlannedAction[] {
  const work = readWork({ work: ctx.workRaw });
  return actions.slice(0, MAX_ACTIONS).map((a) => {
    const b: Base = {
      id: crypto.randomUUID(),
      capture_id: captureId,
      kind: a.kind,
      quote: a.quote.trim().slice(0, 300),
      confidence: Math.min(1, Math.max(0, Number.isFinite(a.confidence) ? a.confidence : 0)),
      payload: { ...a },
    };
    switch (a.kind) {
      case 'set_leave_remaining':
      case 'set_leave_used':
        return leaveBalance(b, a, ctx, work);
      case 'book_leave':
        return bookLeave(b, a, ctx, work);
      case 'update_work_setting':
        return workSetting(b, a, ctx, work);
      case 'set_reminder':
        return reminder(b, a, ctx, newItems);
      case 'reschedule_item':
        return reschedule(b, a, ctx);
      case 'add_prep_rule':
        return prepRule(b, a, ctx, work);
    }
  });
}
