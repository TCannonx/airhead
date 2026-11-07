import type { WorkDay, WorkLocation } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, save } from './repository';

/**
 * A stable id for a user's work-day row on a date (Task 4.7). Every device
 * computes the same id, so two devices setting the same day's location update
 * one row instead of clashing on the server's unique (user_id, date).
 * 128-bit cyrb128 hash, shaped as a UUID (version nibble 8 = custom).
 */
export function workDayId(userId: string, date: string): string {
  const str = `${userId}|work_day|${date}`;
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map((n) => (n >>> 0).toString(16).padStart(8, '0'))
    .join('');
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Sets where I work on a date. Choosing the usual location for that weekday
 * clears the override (soft delete), so pattern changes apply again.
 */
export async function setWorkLocation(
  db: AirheadDb,
  userId: string,
  date: string,
  location: WorkLocation,
  usual: WorkLocation,
): Promise<WorkDay> {
  const id = workDayId(userId, date);
  const existing = await db.work_days.get(id);
  const row: WorkDay = {
    ...(existing ?? { ...baseRecord(userId), id, note: null }),
    date,
    location,
    deleted_at: location === usual ? new Date().toISOString() : null,
  };
  return save(db, 'work_days', row);
}
