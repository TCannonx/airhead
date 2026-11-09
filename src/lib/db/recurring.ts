import {
  overridesOf,
  planDelete,
  planEdit,
  type OccurrenceChanges,
  type Plan,
  type Scope,
} from '../calendar/occurrence';
import type { Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { newItem, save, softDelete, update } from './repository';

/**
 * Edit, move or delete one occurrence of a repeating event (Task 11.5): this
 * event, this and following, or all events. The plan is worked out by
 * `lib/calendar/occurrence.ts`; every row is written through `save`, so each
 * change goes to the outbox and syncs like any other edit.
 */
async function apply(db: AirheadDb, series: Item, plan: Plan): Promise<Item[]> {
  const created: Item[] = [];
  if (plan.series) await update(db, 'items', series.id, plan.series);
  for (const fields of plan.create) {
    created.push(
      await save(
        db,
        'items',
        newItem(series.user_id, {
          ...fields,
          type: fields.type ?? series.type,
          title: fields.title ?? series.title,
        }),
      ),
    );
  }
  for (const u of plan.update) await update(db, 'items', u.id, u.changes);
  for (const id of plan.remove) await softDelete(db, 'items', id);
  return created;
}

async function overrides(db: AirheadDb, series: Item) {
  return overridesOf(
    series,
    await db.items.filter((i) => i.data.parent_id === series.id).toArray(),
  );
}

export async function deleteOccurrence(
  db: AirheadDb,
  series: Item,
  occurrence: string,
  scope: Scope,
  timeZone: string,
): Promise<void> {
  await apply(
    db,
    series,
    planDelete(series, occurrence, scope, await overrides(db, series), timeZone),
  );
}

export async function editOccurrence(
  db: AirheadDb,
  series: Item,
  occurrence: string,
  scope: Scope,
  changes: OccurrenceChanges,
  timeZone: string,
): Promise<Item[]> {
  return apply(
    db,
    series,
    planEdit(series, occurrence, scope, changes, await overrides(db, series), timeZone),
  );
}
