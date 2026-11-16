import type { AirheadDb } from './db/db';

/**
 * The app badge (Task 15.5): overdue tasks plus open questions. The Badging API
 * works only in an installed web app (and on iOS only once notifications are
 * allowed); elsewhere this does nothing.
 */
export async function badgeCount(db: AirheadDb, now = new Date()): Promise<number> {
  const iso = now.toISOString();
  const overdue = await db.items
    .where('[type+status]')
    .equals(['task', 'open'])
    .filter((t) => !t.deleted_at && !!t.due_at && t.due_at < iso)
    .count();
  const questions = await db.follow_ups
    .where('status')
    .equals('open')
    .filter((f) => !f.deleted_at)
    .count();
  return overdue + questions;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Sets or clears the badge; false when the browser has no Badging API. */
export async function applyBadge(count: number, nav: BadgeNavigator = navigator): Promise<boolean> {
  if (!nav.setAppBadge) return false;
  try {
    if (count > 0) await nav.setAppBadge(count);
    else await (nav.clearAppBadge ? nav.clearAppBadge() : nav.setAppBadge(0));
    return true;
  } catch {
    return false;
  }
}
