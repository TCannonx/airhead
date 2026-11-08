import type { AiAction, Item } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, save, softDelete, update } from './repository';
import { updateSettingsData } from './settings';

/**
 * AI actions on the device (Phase 10): Undo what sorting applied, Apply or
 * Dismiss what it proposed. Every write is an ordinary local edit, so it works
 * offline and syncs like any other change. Nothing is overwritten if the
 * target was changed since: the person is sent to it instead.
 */

export type UndoResult = 'undone' | 'changed' | 'missing';
export type ApplyResult = 'applied' | 'changed' | 'needs_fix';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Comparable form: timestamps as epoch ms (servers and devices write them differently), keys sorted. */
function norm(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? v : t;
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, norm(x)]),
    );
  return v ?? null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

const setStatus = (db: AirheadDb, a: AiAction, status: AiAction['status']) =>
  update(db, 'ai_actions', a.id, { status });

/**
 * An undone or dismissed action counts as a correction: it shows in the
 * correction rate (Insights) and the next sorting batch sees it as a habit.
 */
const recordCorrection = (db: AirheadDb, userId: string, a: AiAction, to: 'undone' | 'dismissed') =>
  save(db, 'corrections', {
    ...baseRecord(userId),
    capture_id: a.capture_id,
    from_value: { action: a.kind, summary: a.summary },
    to_value: { action: to },
  });

/** Merges keys into work settings; null removes a key (back to its default). */
function mergeWork(work: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.entries({ ...work, ...patch }).filter(([, v]) => v !== null));
}

const ITEM_COLUMNS = ['start_at', 'end_at', 'all_day', 'due_at', 'data'] as const;

/** Writes `to` over the target if it still holds `from`. */
async function writeTarget(
  db: AirheadDb,
  userId: string,
  a: AiAction,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Promise<'ok' | 'changed' | 'missing'> {
  if (a.target_table === 'settings') {
    const work = ((await db.settings.get(userId))?.data.work ?? {}) as Record<string, unknown>;
    if (!Object.keys(to).every((k) => same(work[k], from[k]))) return 'changed';
    await updateSettingsData(db, userId, { work: mergeWork(work, to) });
    return 'ok';
  }
  if (a.target_table === 'items' && a.target_id) {
    const item = await db.items.get(a.target_id);
    if (!item || item.deleted_at) return 'missing';
    const cols = ITEM_COLUMNS.filter((k) => k in to);
    if (!cols.every((k) => same(item[k], from[k]))) return 'changed';
    await update(db, 'items', item.id, Object.fromEntries(cols.map((k) => [k, to[k]])));
    return 'ok';
  }
  return 'missing';
}

/** Puts back exactly what the action replaced. */
export async function undoAction(db: AirheadDb, userId: string, a: AiAction): Promise<UndoResult> {
  if (a.status !== 'applied') return 'missing';
  if (a.target_table === 'leave_bookings') {
    const b = a.target_id ? await db.leave_bookings.get(a.target_id) : undefined;
    if (!b || b.deleted_at) return 'missing';
    await softDelete(db, 'leave_bookings', b.id);
  } else {
    const r = await writeTarget(db, userId, a, a.after ?? {}, a.before ?? {});
    if (r !== 'ok') return r;
  }
  await setStatus(db, a, 'undone');
  await recordCorrection(db, userId, a, 'undone');
  return 'undone';
}

/** The new times for moving `item` as the proposal's payload says (events keep their length). */
function moveTo(item: Item, p: Record<string, unknown>): Record<string, unknown> | null {
  const iso = (v: unknown) =>
    typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
  if (item.type === 'task') {
    const due = iso(p.due_at) ?? iso(p.start_at);
    return due ? { due_at: due } : null;
  }
  const start = iso(p.start_at);
  if (!start) return null;
  let end = iso(p.end_at);
  if (!end && item.end_at && item.start_at)
    end = new Date(
      Date.parse(start) + Date.parse(item.end_at) - Date.parse(item.start_at),
    ).toISOString();
  return { start_at: start, end_at: end, all_day: (p.all_day as boolean | null) ?? item.all_day };
}

/**
 * Applies a proposal: its `after`, or (for "Which one?") the item picked.
 * Proposals without anything to apply need fixing on their screen instead.
 */
export async function applyProposal(
  db: AirheadDb,
  userId: string,
  a: AiAction,
  choiceId?: string,
): Promise<ApplyResult> {
  if (a.status !== 'proposed') return 'needs_fix';
  if (choiceId) {
    const item = await db.items.get(choiceId);
    if (!item || item.deleted_at) return 'changed';
    const after = moveTo(item, a.payload);
    if (!after) return 'needs_fix';
    await update(db, 'items', item.id, after);
    await update(db, 'ai_actions', a.id, {
      status: 'applied',
      target_table: 'items',
      target_id: item.id,
      before: Object.fromEntries(Object.keys(after).map((k) => [k, item[k as keyof Item]])),
      after,
    });
    return 'applied';
  }
  if (!a.after) return 'needs_fix';
  if (a.target_table === 'leave_bookings') {
    const after = a.after as {
      start_date: string;
      end_date: string;
      start_half?: boolean;
      end_half?: boolean;
      leave_type?: string;
      status?: 'planned' | 'requested' | 'approved' | 'taken';
      days?: number;
    };
    const clash = await db.leave_bookings
      .filter(
        (b) => !b.deleted_at && b.start_date <= after.end_date && b.end_date >= after.start_date,
      )
      .count();
    if (clash) return 'changed';
    await save(db, 'leave_bookings', {
      ...baseRecord(userId),
      id: a.target_id ?? crypto.randomUUID(),
      start_date: after.start_date,
      end_date: after.end_date,
      start_half: after.start_half ?? false,
      end_half: after.end_half ?? false,
      leave_type: after.leave_type ?? 'annual',
      status: after.status ?? 'planned',
      share_us: false,
      days: after.days ?? null,
      note: null,
      capture_id: a.capture_id,
    });
  } else {
    const r = await writeTarget(db, userId, a, a.before ?? {}, a.after);
    if (r === 'changed') return 'changed';
    if (r === 'missing') return 'needs_fix';
  }
  await setStatus(db, a, 'applied');
  return 'applied';
}

export async function dismissAction(db: AirheadDb, userId: string, a: AiAction) {
  await setStatus(db, a, 'dismissed');
  await recordCorrection(db, userId, a, 'dismissed');
}

/** Where to fix or check an action by hand. */
export function fixLink(a: AiAction): string {
  if (a.kind === 'update_work_setting' || a.kind === 'add_prep_rule') return '/settings';
  if (a.kind === 'set_leave_remaining' || a.kind === 'set_leave_used' || a.kind === 'book_leave')
    return '/work';
  const id = a.target_id ?? (typeof a.payload.target_id === 'string' ? a.payload.target_id : null);
  return id ? `/library/item/${id}` : '/inbox';
}

/** The chip under a capture when sorting acted on it, or null. */
export function chipFor(actions: AiAction[]): string | null {
  const asks = actions.filter((a) => a.status === 'proposed').length;
  if (asks) return asks === 1 ? '1 action needs your OK' : `${asks} actions need your OK`;
  const done = actions.filter((a) => a.status === 'applied');
  const [first] = done;
  if (!first) return null;
  return done.length === 1 ? first.summary : `${first.summary} (+${done.length - 1} more)`;
}
