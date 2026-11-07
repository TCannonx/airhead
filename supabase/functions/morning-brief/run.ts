import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { buildBrief, type BuiltBrief, type Digest } from './brief.ts';

/** Database access for one morning brief (a fake in tests, Supabase in production). */
export interface BriefStore {
  digest(userId: string, localDate: string): Promise<Digest>;
  settings(userId: string): Promise<Record<string, unknown>>;
  /** Memory profile text for the cached system block. */
  profile(userId: string): Promise<string>;
  saveBrief(userId: string, localDate: string, brief: BuiltBrief): Promise<void>;
  /** Marks tasks as today's Top 3. */
  setTop3(userId: string, itemIds: string[], localDate: string): Promise<void>;
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

  const [settings, profile] = await Promise.all([
    deps.store.settings(userId),
    deps.store.profile(userId),
  ]);
  const brief = await buildBrief(userId, digest, settings, now, {
    ai: deps.ai,
    store: deps.usage,
    profile,
  });

  await deps.store.saveBrief(userId, localDate, brief);
  await deps.store.setTop3(
    userId,
    brief.content.top3.map((t) => t.item_id),
    localDate,
  );
  await deps.store.cancelPrep(userId, localDate);
  for (const [i, p] of brief.content.prep.entries()) {
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
