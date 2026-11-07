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

export const completeTask = (db: AirheadDb, id: string) =>
  update(db, 'items', id, { status: 'done', completed_at: new Date().toISOString() });

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
