import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { buildBrief, enrichDigest, type BuiltBrief, type Digest } from './brief.ts';
import { localNow } from '../scheduler-tick/notif.ts';

/** Database access for one morning brief (a fake in tests, Supabase in production). */
export interface BriefStore {
  digest(userId: string, localDate: string): Promise<Digest>;
  settings(userId: string): Promise<Record<string, unknown>>;
  /** Memory profile text for the cached system block. */
  profile(userId: string): Promise<string>;
  /** The last weekly digests, newest first (Task 8.5); optional for older fakes. */
  recentWeeks?(userId: string, n: number): Promise<{ week_start: string; digest: string }[]>;
  saveBrief(userId: string, localDate: string, brief: BuiltBrief): Promise<void>;
  /** Marks tasks as today's Top 3. */
  setTop3(userId: string, itemIds: string[], localDate: string): Promise<void>;
  /**
   * Items with a planner prepare nudge (plan:prepare:<item id>:<localDate>), pending or
   * sent (Task 13.4). Optional for older fakes.
   */
  planPrepared?(userId: string, itemIds: string[], localDate: string): Promise<Set<string>>;
  /** Cancels pending prep nudges from an earlier brief the same day (Regenerate). */
  cancelPrep(userId: string, localDate: string): Promise<void>;
  addNudge(
    userId: string,
    n: {
      kind: 'prep' | 'morning_brief';
      item_id: string | null;
      send_at: string;
      title: string;
      body: string;
      url: string;
      dedupe_key: string;
    },
  ): Promise<void>;
}

/** No same-day prep nudge for anything starting within this many minutes of the brief. */
export const PREP_MIN_LEAD = 120;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Which of the brief's prep nudges to send (Task 13.4): none for an item that
 * starts today within 2 hours of the brief (a 07:30 "pack your bag" for 08:00
 * is too late), and none for an occurrence the planner already prepared the
 * evening before. The brief text may still mention the prep.
 */
export function keepPrep<T extends { item_id: string | null }>(
  prep: T[],
  starts: Map<string, number>,
  briefMinutes: number,
  planned: Set<string>,
): T[] {
  return prep.filter((p) => {
    if (!p.item_id) return true;
    if (planned.has(p.item_id)) return false;
    const start = starts.get(p.item_id);
    return start === undefined || start - briefMinutes >= PREP_MIN_LEAD;
  });
}

/** Today's start time (local minutes) of each timed event in the digest, one-off or repeating. */
export function todayStarts(digest: Digest, settings: Record<string, unknown>): Map<string, number> {
  const starts = new Map<string, number>();
  const e = enrichDigest(digest, settings);
  for (const x of [...e.events, ...e.recurring_events]) {
    if (x.date === digest.date && x.start && !starts.has(x.id)) starts.set(x.id, minutes(x.start));
  }
  return starts;
}

export type BriefRunResult =
  { status: 'ok' | 'fallback'; brief: BuiltBrief } | { status: 'skipped'; reason: 'quiet_day' };

/**
 * Builds and stores the morning brief for a person's local date (Task 5.4):
 * saves it, marks the Top 3, writes prep nudges and (for the scheduled run)
 * a round-up notification. A day with no tasks and no events is skipped.
 */
export async function runMorningBrief(
  userId: string,
  localDate: string,
  now: Date,
  deps: { store: BriefStore; ai: AIClient; usage: UsageStore },
  opts: { roundUp: boolean },
): Promise<BriefRunResult> {
  const digest = await deps.store.digest(userId, localDate);
  const eventsToday =
    digest.events.some((e) => e.date === localDate) ||
    digest.linked.some((e) => e.date === localDate) ||
    digest.recurring.length > 0;
  if (digest.tasks.length === 0 && !eventsToday) return { status: 'skipped', reason: 'quiet_day' };

  const [settings, profile, recentWeeks] = await Promise.all([
    deps.store.settings(userId),
    deps.store.profile(userId),
    deps.store.recentWeeks?.(userId, 4) ?? Promise.resolve([]),
  ]);
  const brief = await buildBrief(userId, digest, settings, now, {
    ai: deps.ai,
    store: deps.usage,
    profile,
    recentWeeks,
  });

  await deps.store.saveBrief(userId, localDate, brief);
  await deps.store.setTop3(
    userId,
    brief.content.top3.map((t) => t.item_id),
    localDate,
  );
  await deps.store.cancelPrep(userId, localDate);
  const prepIds = brief.content.prep.flatMap((p) => (p.item_id ? [p.item_id] : []));
  const planned =
    prepIds.length && deps.store.planPrepared
      ? await deps.store.planPrepared(userId, prepIds, localDate)
      : new Set<string>();
  const prep = keepPrep(
    brief.content.prep,
    todayStarts(digest, settings),
    minutes(localNow(now, digest.time_zone).hhmm),
    planned,
  );
  for (const [i, p] of prep.entries()) {
    await deps.store.addNudge(userId, {
      kind: 'prep',
      item_id: p.item_id,
      send_at: p.send_at,
      title: p.text,
      body: '',
      url: '/today',
      dedupe_key: `prep:${localDate}:${now.getTime()}:${i}`,
    });
  }
  if (opts.roundUp) {
    const top = brief.content.top3.map((t) => t.title).filter(Boolean);
    await deps.store.addNudge(userId, {
      kind: 'morning_brief',
      item_id: null,
      send_at: now.toISOString(),
      title: 'Good morning',
      body: top.length ? `Top 3: ${top.join(' · ')}` : 'Your day is ready.',
      url: '/today',
      dedupe_key: `brief:${localDate}`,
    });
  }
  return { status: brief.status, brief };
}
