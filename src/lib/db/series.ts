import type { AirheadDb } from './db';
import { softDelete, update } from './repository';

/**
 * A series and its events (imported schedules): delete or recolour the whole
 * set at once. Deleting is soft, so everything is restorable from the Trash
 * for 30 days.
 */
export async function deleteSeries(db: AirheadDb, seriesId: string): Promise<number> {
  const items = await db.items.filter((i) => i.series_id === seriesId && !i.deleted_at).toArray();
  for (const i of items) await softDelete(db, 'items', i.id);
  await softDelete(db, 'series', seriesId);
  return items.length;
}

export const recolourSeries = (db: AirheadDb, seriesId: string, colour: string | null) =>
  update(db, 'series', seriesId, { colour });
