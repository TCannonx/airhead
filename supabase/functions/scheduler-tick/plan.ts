import { defaultNudges, readPlanSettings, type PlanItem } from '../_shared/plan/defaults.ts';
import { occurrencesBetween } from './tick.ts';
import { localNow } from './notif.ts';

/**
 * Defaults applied on save (Task 13.3). A trigger on items queues an item in
 * plan_queue; each tick drains the queue and writes default nudges for the
 * item's occurrences in the next 8 days, keyed plan:<kind>:<item id>:<local date>.
 * The SQL writer never overwrites an 'ai' or 'user' nudge with a default.
 */
export interface QueuedItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  status: string;
  all_day: boolean;
  start_at: string | null;
  due_at: string | null;
  rrule: string | null;
  deleted_at: string | null;
  data: Record<string, unknown>;
}

export interface PlanNudgeWrite {
  key: string;
  kind: string;
  item_id: string;
  send_at: string;
  title: string;
  body: string;
  url: string;
  reason: string;
}

export interface PlanQueueStore {
  /** Oldest queued item ids first, at most `limit`. */
  queued(limit: number): Promise<string[]>;
  /** The item rows (missing ids are items deleted for good). */
  items(ids: string[]): Promise<QueuedItem[]>;
  /** settings.data for a person. */
  settings(userId: string): Promise<Record<string, unknown>>;
  /** item_plans.prep for an item, if planned. */
  prep(itemId: string): Promise<string[]>;
  /** Pending plan:* nudge keys for an item. */
  pendingKeys(userId: string, itemId: string): Promise<{ key: string; source: string }[]>;
  /** public.upsert_plan_nudge with source 'default'. */
  upsert(userId: string, n: PlanNudgeWrite): Promise<void>;
  cancel(userId: string, key: string): Promise<void>;
  dequeue(ids: string[]): Promise<void>;
}

export const PLAN_HORIZON_MS = 8 * 86_400_000;
const DRAIN_LIMIT = 50;

/** One occurrence: its instant and local date. Tasks use the due time; events the start. */
export function occurrencesOf(item: QueuedItem, now: Date, tz: string): Date[] {
  const to = new Date(now.getTime() + PLAN_HORIZON_MS);
  if (item.type === 'event' && item.start_at) {
    if (item.rrule) {
      return occurrencesBetween(
        {
          id: item.id,
          title: item.title,
          start_at: item.start_at,
          rrule: item.rrule,
          data: item.data,
        },
        now,
        to,
        tz,
      );
    }
    const s = new Date(item.start_at);
    return s > now && s <= to ? [s] : [];
  }
  if (item.type === 'task' && item.due_at) {
    const d = new Date(item.due_at);
    return d > now && d <= to ? [d] : [];
  }
  return [];
}

export function matchesPrepRule(title: string, settings: Record<string, unknown>): boolean {
  const work = (settings.work ?? {}) as { prep_rules?: unknown };
  const rules = Array.isArray(work.prep_rules) ? work.prep_rules : [];
  const t = title.toLowerCase();
  return rules.some((r) => {
    const match = (r as { match?: unknown })?.match;
    return (
      Array.isArray(match) &&
      match.some(
        (w) => typeof w === 'string' && w.trim().length >= 2 && t.includes(w.trim().toLowerCase()),
      )
    );
  });
}

/** Writes the defaults for each queued item. Returns how many nudges were written. */
export async function drainPlanQueue(
  now: Date,
  store: PlanQueueStore,
): Promise<{ items: number; written: number; cancelled: number }> {
  const ids = await store.queued(DRAIN_LIMIT);
  if (!ids.length) return { items: 0, written: 0, cancelled: 0 };
  let written = 0;
  let cancelled = 0;
  const settingsCache = new Map<string, Record<string, unknown>>();

  for (const item of await store.items(ids)) {
    let settings = settingsCache.get(item.user_id);
    if (!settings) {
      settings = await store.settings(item.user_id);
      settingsCache.set(item.user_id, settings);
    }
    const tz = typeof settings.time_zone === 'string' ? settings.time_zone : 'Europe/Dublin';
    const plan = readPlanSettings(settings);
    const live = item.status === 'open' && item.deleted_at === null;
    const keep = new Set<string>();
    const liveDates = new Set<string>();
    if (live) {
      const travel = item.data.travel_minutes;
      const planItem: PlanItem = {
        type: item.type,
        title: item.title,
        all_day: item.all_day,
        travel_minutes: typeof travel === 'number' ? travel : null,
        prep: await store.prep(item.id),
        has_prep_rule: matchesPrepRule(item.title, settings),
      };
      for (const occ of occurrencesOf(item, now, tz)) {
        const date = localNow(occ, tz).date;
        liveDates.add(date);
        for (const n of defaultNudges(planItem, occ, plan, tz, now)) {
          const key = `plan:${n.kind}:${item.id}:${date}`;
          keep.add(key);
          await store.upsert(item.user_id, {
            key,
            kind: n.kind,
            item_id: item.id,
            send_at: n.at,
            title: n.title,
            body: `${n.reason} · ${localNow(occ, tz).hhmm}`,
            url: `/library/item/${item.id}`,
            reason: n.reason,
          });
          written++;
        }
      }
    }
    // Occurrences that no longer exist (moved, deleted, done) lose their plan nudges.
    // A default that no longer applies goes too; AI or owner nudges for a live occurrence stay.
    for (const p of await store.pendingKeys(item.user_id, item.id)) {
      if (keep.has(p.key)) continue;
      const date = p.key.split(':').slice(3).join(':');
      if (!liveDates.has(date) || p.source === 'default') {
        await store.cancel(item.user_id, p.key);
        cancelled++;
      }
    }
  }
  await store.dequeue(ids);
  return { items: ids.length, written, cancelled };
}
