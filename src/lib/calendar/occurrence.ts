import { TZDate } from '@date-fns/tz';
import { addDays } from '../holidays/easter';
import type { Item } from '../schemas/records';
import { WEEKDAYS, ruleParts, untilValue } from './repeat';
import { expandOccurrences, localDate } from './sources';

/**
 * One occurrence of a repeating event (Task 11.5), the RFC 5545 way the item
 * row allows without new columns:
 * - an exception is the occurrence's start in the series' `data.exdates`
 *   (ISO instants, as `expandOccurrences` returns them);
 * - a changed occurrence is that exception plus a one-off item whose
 *   `data.parent_id` is the series and `data.recurrence_id` the original start;
 * - "this and following" ends the series with UNTIL the day before and starts
 *   a new series at the occurrence.
 */
export type Scope = 'this' | 'following' | 'all';

/** The exceptions of a series. */
export function exdatesOf(item: Pick<Item, 'data'>): string[] {
  const raw = item.data.exdates;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/** True when an instant is one of the series' exceptions. */
export function isExcluded(item: Pick<Item, 'data'>, iso: string): boolean {
  const t = Date.parse(iso);
  return exdatesOf(item).some((x) => Date.parse(x) === t);
}

/** The exceptions plus one more (as a plain UTC ISO), no duplicates. */
export function withExdate(item: Pick<Item, 'data'>, iso: string): string[] {
  const t = Date.parse(iso);
  const rest = exdatesOf(item).filter((x) => Date.parse(x) !== t);
  return [...rest, new Date(t).toISOString()].sort();
}

/** True when the occurrence is the series' first (so "this and following" means all). */
export function isFirstOccurrence(item: Pick<Item, 'start_at'>, occurrence: string): boolean {
  return !!item.start_at && Date.parse(occurrence) <= Date.parse(item.start_at);
}

/** The rule with any UNTIL or COUNT replaced by UNTIL the local day before `occurrence`. */
export function endBefore(rrule: string, occurrence: string, timeZone: string): string {
  const parts = ruleParts(rrule);
  parts.delete('UNTIL');
  parts.delete('COUNT');
  parts.set('UNTIL', untilValue(addDays(localDate(occurrence, timeZone), -1)));
  return [...parts.entries()].map(([k, v]) => `${k}=${v}`).join(';');
}

/** How many occurrences of the series come before `occurrence`. */
export function countBefore(item: Item, occurrence: string, timeZone: string): number {
  if (!item.start_at) return 0;
  const end = Date.parse(occurrence);
  return expandOccurrences(
    { ...item, data: {} },
    { start: new Date(Date.parse(item.start_at)), end: new Date(end) },
    timeZone,
  ).filter((o) => Date.parse(o) < end).length;
}

/** A COUNT rule continued from `occurrence`: the times that are left. */
export function remainingRule(item: Item, rule: string, occurrence: string, timeZone: string) {
  const parts = ruleParts(rule);
  const count = Number(parts.get('COUNT') ?? 0);
  if (!count) return rule;
  parts.set('COUNT', String(Math.max(1, count - countBefore(item, occurrence, timeZone))));
  return [...parts.entries()].map(([k, v]) => `${k}=${v}`).join(';');
}

/** Moves a weekly rule's days by `days` (Thursday moved to Friday: BYDAY=TH → FR). */
export function shiftByDay(rule: string, days: number): string {
  const shift = ((days % 7) + 7) % 7;
  const parts = ruleParts(rule);
  const byDay = parts.get('BYDAY');
  if (!shift || !byDay || parts.get('FREQ') !== 'WEEKLY') return rule;
  const order = WEEKDAYS.map((w) => w.code as string);
  const moved = byDay.split(',').map((d) => {
    const i = order.indexOf(d);
    return i < 0 ? d : (order[(i + shift) % 7] ?? d);
  });
  parts.set('BYDAY', order.filter((d) => moved.includes(d)).join(','));
  return [...parts.entries()].map(([k, v]) => `${k}=${v}`).join(';');
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * A move of one occurrence (from → to) applied to another instant: the same
 * number of local days later, at the new local time of day (wall clock, so a
 * move made in November lands right in July too). All-day: local midnight.
 */
export function makeShift(from: string, to: string, allDay: boolean, timeZone: string) {
  const days = dayDiff(localDate(from, timeZone), localDate(to, timeZone));
  const t = new TZDate(Date.parse(to), timeZone);
  const f = new TZDate(Date.parse(from), timeZone);
  const same = days === 0 && t.getHours() === f.getHours() && t.getMinutes() === f.getMinutes();
  const apply = (iso: string) => {
    const [y, m, d] = addDays(localDate(iso, timeZone), days).split('-').map(Number) as [
      number,
      number,
      number,
    ];
    const at = allDay
      ? new TZDate(y, m - 1, d, timeZone)
      : new TZDate(y, m - 1, d, t.getHours(), t.getMinutes(), timeZone);
    return new Date(at.getTime()).toISOString();
  };
  return { days, same, apply };
}

export interface OccurrenceChanges {
  title?: string;
  body?: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  calendar?: Item['calendar'];
  /** The repeat rule the form now has (ignored for "this event"). */
  rrule?: string | null;
  /** Data fields to set (location, reminder); exceptions and links are handled here. */
  data?: Record<string, unknown>;
}

const LINKS = ['exdates', 'parent_id', 'recurrence_id'];
const withoutLinks = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).filter(([k]) => !LINKS.includes(k)));

/** The rows to write for a change to one occurrence, as plain data (no database). */
export interface Plan {
  /** Changes to the series row. */
  series: Partial<Item> | null;
  /** New rows: the one-off (this event) or the new series (this and following). */
  create: Partial<Item>[];
  /** Other rows to change (overrides that move to the new series), by id. */
  update: { id: string; changes: Partial<Item> }[];
  /** Rows to soft delete (overrides of deleted occurrences). */
  remove: string[];
}

const recurrenceIdOf = (i: Item) =>
  typeof i.data.recurrence_id === 'string' ? i.data.recurrence_id : null;

/** Overrides of a series: one-off items whose data.parent_id is the series. */
export function overridesOf(series: Item, items: Item[]): Item[] {
  return items.filter((i) => i.data.parent_id === series.id && !i.deleted_at);
}

/** What deleting `occurrence` of a series with a scope means for each row. */
export function planDelete(
  series: Item,
  occurrence: string,
  scope: Scope,
  overrides: Item[],
  timeZone: string,
): Plan {
  const plan: Plan = { series: null, create: [], update: [], remove: [] };
  if (scope === 'all' || (scope === 'following' && isFirstOccurrence(series, occurrence))) {
    plan.series = { deleted_at: new Date().toISOString() };
    plan.remove = overrides.map((o) => o.id);
    return plan;
  }
  if (scope === 'this') {
    plan.series = { data: { ...series.data, exdates: withExdate(series, occurrence) } };
    return plan;
  }
  const cut = Date.parse(occurrence);
  plan.series = {
    rrule: endBefore(series.rrule ?? '', occurrence, timeZone),
    data: {
      ...series.data,
      exdates: exdatesOf(series).filter((x) => Date.parse(x) < cut),
    },
  };
  plan.remove = overrides
    .filter((o) => {
      const r = recurrenceIdOf(o);
      return r !== null && Date.parse(r) >= cut;
    })
    .map((o) => o.id);
  return plan;
}

/**
 * What changing `occurrence` of a series with a scope means for each row.
 * `changes` hold the occurrence's new times and fields, as the form shows them.
 */
export function planEdit(
  series: Item,
  occurrence: string,
  scope: Scope,
  changes: OccurrenceChanges,
  overrides: Item[],
  timeZone: string,
): Plan {
  const plan: Plan = { series: null, create: [], update: [], remove: [] };
  const fields = {
    ...(changes.title !== undefined ? { title: changes.title } : {}),
    ...(changes.body !== undefined ? { body: changes.body } : {}),
    ...(changes.calendar !== undefined ? { calendar: changes.calendar } : {}),
  };
  const data = { ...withoutLinks(series.data), ...(changes.data ?? {}) };
  const clean = (d: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v !== undefined));
  const duration =
    changes.end_at !== null ? Date.parse(changes.end_at) - Date.parse(changes.start_at) : null;
  const shift = makeShift(occurrence, changes.start_at, changes.all_day, timeZone);
  const rule = changes.rrule === undefined ? series.rrule : changes.rrule;
  const ruleChanged = rule !== series.rrule;

  if (scope === 'this') {
    plan.series = { data: { ...series.data, exdates: withExdate(series, occurrence) } };
    plan.create.push({
      type: series.type,
      title: series.title,
      body: series.body,
      calendar: series.calendar,
      series_id: series.series_id,
      status: series.status,
      ...fields,
      start_at: changes.start_at,
      end_at: changes.end_at,
      all_day: changes.all_day,
      rrule: null,
      data: clean({
        ...data,
        parent_id: series.id,
        recurrence_id: new Date(Date.parse(occurrence)).toISOString(),
      }),
    });
    return plan;
  }

  if (scope === 'all' || isFirstOccurrence(series, occurrence)) {
    const start = series.start_at ? shift.apply(series.start_at) : changes.start_at;
    plan.series = {
      ...fields,
      start_at: start,
      end_at: duration === null ? null : new Date(Date.parse(start) + duration).toISOString(),
      all_day: changes.all_day,
      rrule: rule && !ruleChanged ? shiftByDay(rule, shift.days) : rule,
      data: clean({
        ...data,
        ...(exdatesOf(series).length
          ? { exdates: shift.same ? exdatesOf(series) : exdatesOf(series).map(shift.apply) }
          : {}),
      }),
    };
    return plan;
  }

  // This and following: the old series ends the day before, a new one starts here.
  const cut = Date.parse(occurrence);
  const before = exdatesOf(series).filter((x) => Date.parse(x) < cut);
  const after = exdatesOf(series).filter((x) => Date.parse(x) >= cut);
  plan.series = {
    rrule: endBefore(series.rrule ?? '', occurrence, timeZone),
    data: { ...series.data, exdates: before },
  };
  const id = crypto.randomUUID();
  const nextRule = rule
    ? ruleChanged
      ? rule
      : shiftByDay(remainingRule(series, rule, occurrence, timeZone), shift.days)
    : null;
  plan.create.push({
    id,
    type: series.type,
    title: series.title,
    body: series.body,
    calendar: series.calendar,
    series_id: series.series_id,
    status: series.status,
    ...fields,
    start_at: changes.start_at,
    end_at: changes.end_at,
    all_day: changes.all_day,
    rrule: nextRule,
    data: clean({
      ...data,
      ...(after.length ? { exdates: shift.same ? after : after.map(shift.apply) } : {}),
    }),
  });
  for (const o of overrides) {
    const r = recurrenceIdOf(o);
    if (r === null || Date.parse(r) < cut) continue;
    plan.update.push({
      id: o.id,
      changes: {
        data: { ...o.data, parent_id: id, recurrence_id: shift.same ? r : shift.apply(r) },
      },
    });
  }
  return plan;
}
