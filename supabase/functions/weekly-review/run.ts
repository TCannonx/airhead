import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { buildReview, type BuiltReview, type Candidate, type FactIn } from './review.ts';

/** Database access for one weekly review (a fake in tests, Supabase in production). */
export interface ReviewStore {
  digest(userId: string, weekStart: string): Promise<Record<string, unknown>>;
  /** Digests of earlier weeks, newest first. */
  pastDigests(
    userId: string,
    before: string,
    n: number,
  ): Promise<{ week_start: string; digest: string }[]>;
  candidates(userId: string): Promise<Candidate[]>;
  facts(userId: string): Promise<FactIn[]>;
  /** Moves items or captures to the Trash (soft delete, recoverable for 30 days). */
  softDelete(userId: string, kind: 'item' | 'capture', ids: string[]): Promise<void>;
  saveReview(userId: string, weekStart: string, review: BuiltReview): Promise<void>;
  addNudge(
    userId: string,
    n: { title: string; body: string; url: string; dedupe_key: string },
  ): Promise<void>;
}

/** The Monday of the week before `localDate`'s week (the review looks back). */
export function lastWeekStart(localDate: string): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0
  d.setUTCDate(d.getUTCDate() - dow);
  // A Sunday review covers the week ending today; any other day, the week before.
  if (dow !== 6) d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/**
 * The weekly review (Task 8.3): one large-tier call over the week's digest,
 * earlier digests and the Tidy-up candidates. Low-risk candidates go to the
 * Trash without asking; everything else waits on the Tidy-up card.
 */
export async function runWeeklyReview(
  userId: string,
  weekStart: string,
  deps: { store: ReviewStore; ai: AIClient; usage: UsageStore },
  opts: { notify: boolean },
): Promise<BuiltReview> {
  const { store } = deps;
  const [week, past, candidates, facts] = await Promise.all([
    store.digest(userId, weekStart),
    store.pastDigests(userId, weekStart, 4),
    store.candidates(userId),
    store.facts(userId),
  ]);
  const built = await buildReview(userId, week, past, candidates, facts, {
    ai: deps.ai,
    store: deps.usage,
  });
  const auto = candidates.filter((c) => c.mode === 'auto');
  for (const kind of ['item', 'capture'] as const) {
    const ids = auto.filter((c) => c.kind === kind).map((c) => c.id);
    if (ids.length) await store.softDelete(userId, kind, ids);
  }
  const review: BuiltReview = {
    ...built,
    content: {
      ...built.content,
      auto_done: auto.map((c) => ({ kind: c.kind, id: c.id, title: c.title, reason: c.reason })),
    },
  };
  await store.saveReview(userId, weekStart, review);
  if (opts.notify) {
    const n = review.content.tidy.filter((t) => t.proposal !== 'keep').length;
    await store.addNudge(userId, {
      title: 'Your weekly review is ready',
      body: review.content.themes[0]
        ? `${review.content.themes[0]}${n ? ` · ${n} to tidy` : ''}`
        : 'See how the week went.',
      url: '/insights',
      dedupe_key: `weekly_review:${weekStart}`,
    });
  }
  return review;
}
