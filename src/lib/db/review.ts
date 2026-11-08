import { RRule } from 'rrule';
import { addDays } from '../holidays/easter';
import { localDate, localMidnight } from '../calendar/sources';
import type { Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { update } from './repository';

/**
 * Evening review (Task 4.14): today's open tasks (due today or earlier, or in
 * today's Top 3), each ticked off, carried over to tomorrow or dropped.
 */
export function reviewTasks(items: Item[], today: string, tz: string): Item[] {
  return items
    .filter(
      (i) =>
        i.type === 'task' &&
        i.status === 'open' &&
        !i.deleted_at &&
        (i.top3_date === today || (i.due_at !== null && localDate(i.due_at, tz) <= today)),
    )
    .sort(
      (a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? '') || a.title.localeCompare(b.title),
    );
}

/**
 * The next due time of a repeating task after `now` (or after its current due
 * time, if that is later). Null when the rule is unreadable or has ended.
 */
export function nextDue(rrule: string, dueAt: string, now: Date): string | null {
  const start = new Date(dueAt);
  if (Number.isNaN(start.getTime())) return null;
  let options;
  try {
    options = RRule.parseString(rrule.replace(/^RRULE:/, ''));
  } catch {
    return null;
  }
  const rule = new RRule({ ...options, dtstart: start });
  const from = new Date(Math.max(now.getTime(), start.getTime()));
  return rule.after(from, false)?.toISOString() ?? null;
}

/**
 * Ticks a task off. A repeating task ("text the barber every 2 weeks") moves
 * on to its next due time instead of finishing, so its reminder fires again.
 */
export async function completeTask(db: AirheadDb, id: string) {
  const now = new Date();
  const item = await db.items.get(id);
  if (item?.rrule && item.due_at) {
    const next = nextDue(item.rrule, item.due_at, now);
    if (next)
      return update(db, 'items', id, {
        due_at: next,
        completed_at: now.toISOString(),
        top3_date: null,
        carry_count: 0,
        data: { ...item.data, last_done_at: now.toISOString() },
      });
  }
  return update(db, 'items', id, { status: 'done', completed_at: now.toISOString() });
}

export const dropTask = (db: AirheadDb, id: string) =>
  update(db, 'items', id, { status: 'dropped' });

/**
 * Moves a task to tomorrow: a due time keeps its local time of day; a Top 3
 * place moves to tomorrow's Top 3. carry_count goes up by one (the slip nudge
 * looks for 3 or more).
 */
export async function carryOver(
  db: AirheadDb,
  item: Item,
  today: string,
  tz: string,
): Promise<void> {
  const tomorrow = addDays(today, 1);
  let due_at = item.due_at;
  if (due_at) {
    const dayStart = Date.parse(localMidnight(localDate(due_at, tz), tz));
    const timeOfDay = Date.parse(due_at) - dayStart;
    due_at = new Date(Date.parse(localMidnight(tomorrow, tz)) + timeOfDay).toISOString();
  }
  await update(db, 'items', item.id, {
    due_at,
    top3_date: item.top3_date === today ? tomorrow : item.top3_date,
    carry_count: item.carry_count + 1,
  });
}
