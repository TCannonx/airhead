import { localDate } from '../calendar/sources';
import { addDays } from '../holidays/easter';
import type { Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { update } from './repository';

/** Today's Top 3 by hand (Task 5.8): at most three open tasks per day. */
export const TOP3_MAX = 3;

export async function todaysTop3(db: AirheadDb, today: string): Promise<Item[]> {
  return (await db.items.where('type').equals('task').toArray()).filter(
    (i) => i.top3_date === today && i.status === 'open' && !i.deleted_at,
  );
}

/** Adds a task, or says which three it would have to swap with. */
export async function addToTop3(
  db: AirheadDb,
  itemId: string,
  today: string,
): Promise<{ added: true } | { added: false; full: Item[] }> {
  const current = (await todaysTop3(db, today)).filter((i) => i.id !== itemId);
  if (current.length >= TOP3_MAX) return { added: false, full: current };
  await update(db, 'items', itemId, { top3_date: today });
  return { added: true };
}

export async function swapIntoTop3(db: AirheadDb, outId: string, inId: string, today: string) {
  await update(db, 'items', outId, { top3_date: null });
  await update(db, 'items', inId, { top3_date: today });
}

export const removeFromTop3 = (db: AirheadDb, itemId: string) =>
  update(db, 'items', itemId, { top3_date: null });

/**
 * Yesterday's unfinished business for the morning cards: open tasks that were
 * in yesterday's Top 3 or due yesterday, and aren't already in today's.
 */
export function carryOverCandidates(items: Item[], today: string, tz: string): Item[] {
  const yesterday = addDays(today, -1);
  return items.filter(
    (i) =>
      i.type === 'task' &&
      i.status === 'open' &&
      !i.deleted_at &&
      i.top3_date !== today &&
      (i.top3_date === yesterday || (i.due_at !== null && localDate(i.due_at, tz) === yesterday)),
  );
}
