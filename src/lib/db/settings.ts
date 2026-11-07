import type { SettingsRow } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, save } from './repository';

/** The user's settings row. Its id is the user id, so every device writes the same row. */
export const getSettings = (db: AirheadDb, userId: string) => db.settings.get(userId);

/** Merges keys into settings.data, locally first (sync pushes it). */
export async function updateSettingsData(
  db: AirheadDb,
  userId: string,
  patch: Record<string, unknown>,
): Promise<SettingsRow> {
  const existing = await db.settings.get(userId);
  const row: SettingsRow = existing ?? { ...baseRecord(userId), id: userId, data: {} };
  return save(db, 'settings', { ...row, data: { ...row.data, ...patch } });
}
