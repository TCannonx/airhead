import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { buildSortMessage, SORT_BATCH_SYSTEM } from '../_shared/prompts/sort-batch.v4.ts';
import { buildProfile, type FactRow } from '../_shared/memory.ts';
import { relevantFacts, withRelevant } from '../_shared/relevant.ts';
import { SortResult } from '../_shared/schemas/sort.ts';
import { type ActionContext, type BookingRow, type ItemRow } from './actions.ts';
import { type CandidateRow, pickCandidates } from './candidates.ts';
import { planSort } from './plan.ts';

export const BATCH_SIZE = 20;

export interface SortBatchOutcome extends Record<string, unknown> {
  ok: boolean;
  error_code: string | null;
  message: string;
  sorted: number;
  items: number;
}

/** Sorts up to 20 of the user's oldest unsorted captures in one small-tier call. */
export async function runSortBatch(
  deps: {
    db: SupabaseClient;
    ai: AIClient;
    store: UsageStore;
    now?: Date;
    /** gte-small in the Edge Runtime; without it, relevant facts are picked by keywords. */
    embed?: (text: string) => Promise<number[]>;
  },
  userId: string,
  background: boolean,
): Promise<SortBatchOutcome> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  const { data: captures, error } = await db
    .from('captures')
    .select('id, text, url')
    .eq('user_id', userId)
    .eq('status', 'unsorted')
    .is('deleted_at', null)
    .order('captured_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`load captures: ${error.message}`);
  const batch = (captures ?? []).filter((c) => (c.text ?? c.url ?? '').trim());

  // Saved web pages waiting for a summary share the batch (their text was
  // stored by read-link and is cleared once summarised).
  const { data: pending } = await db
    .from('captures')
    .select('id, text, url, payload')
    .eq('user_id', userId)
    .eq('payload->>summary_pending', 'true')
    .is('deleted_at', null)
    .order('captured_at', { ascending: true })
    .limit(Math.max(0, BATCH_SIZE - batch.length));
  const links = (pending ?? []).filter(
    (c) => typeof (c.payload as { article_text?: unknown })?.article_text === 'string',
  );

  if (batch.length === 0 && links.length === 0) {
    return { ok: true, error_code: null, message: 'Nothing to sort.', sorted: 0, items: 0 };
  }

  const [settings, topics, lists, ideas, corrections, candidateRows, bookingRows] =
    await Promise.all([
      db.from('settings').select('data').eq('user_id', userId).maybeSingle(),
      db.from('topics').select('id, name').eq('user_id', userId).is('deleted_at', null),
      db.from('lists').select('id, name').eq('user_id', userId).is('deleted_at', null),
      db
        .from('items')
        .select('id, title')
        .eq('user_id', userId)
        .eq('type', 'idea')
        .eq('status', 'open')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(30),
      db
        .from('corrections')
        .select('capture_id, from_value, to_value')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5),
      // Existing items a capture may move (Phase 10); picked and capped below.
      db
        .from('items')
        .select(
          'id, type, title, start_at, end_at, all_day, due_at, rrule, series_id, status, data, updated_at',
        )
        .eq('user_id', userId)
        .in('type', ['event', 'task'])
        .eq('status', 'open')
        .is('deleted_at', null)
        .limit(400),
      db
        .from('leave_bookings')
        .select('id, start_date, end_date, start_half, end_half, leave_type, status, deleted_at')
        .eq('user_id', userId)
        .is('deleted_at', null),
    ]);
  const candidates = pickCandidates((candidateRows.data ?? []) as CandidateRow[], now);
  const timeZone =
    ((settings.data?.data as { time_zone?: string } | undefined)?.time_zone as string) ||
    'Europe/Dublin';
  const settingsData = (settings.data?.data ?? {}) as Record<string, unknown>;
  const workRaw =
    settingsData.work && typeof settingsData.work === 'object' && !Array.isArray(settingsData.work)
      ? (settingsData.work as Record<string, unknown>)
      : {};
  const actx: ActionContext = {
    userId,
    now,
    today: new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now),
    timeZone,
    workRaw,
    bookings: (bookingRows.data ?? []) as BookingRow[],
    candidates,
    items: new Map(((candidateRows.data ?? []) as ItemRow[]).map((r) => [r.id, r])),
  };

  // Show each correction with the capture it was about, so the model can learn the habit.
  const corrRows = corrections.data ?? [];
  const corrCaptureIds = corrRows.map((c) => c.capture_id).filter(Boolean);
  const corrTexts = corrCaptureIds.length
    ? ((await db.from('captures').select('id, text').in('id', corrCaptureIds)).data ?? [])
    : [];
  const textById = new Map(corrTexts.map((c) => [c.id, c.text ?? '']));

  const ctx = {
    now: now.toISOString(),
    timeZone,
    topics: (topics.data ?? []).map((t) => t.name),
    lists: (lists.data ?? []).map((l) => l.name),
    ideas: (ideas.data ?? []).map((i) => i.title),
    corrections: corrRows.map((c) => ({
      capture: textById.get(c.capture_id) ?? '',
      from: c.from_value,
      to: c.to_value,
    })),
    candidates,
  };

  // Core memory profile: active facts, most recently used first, ~400 words.
  const { data: factRows } = await db
    .from('memory_facts')
    .select('id, text, last_used_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null);
  const profile = buildProfile((factRows ?? []) as FactRow[]);
  // Beyond the core profile: the facts most like these captures (Task 7.11).
  const extra = await relevantFacts(
    {
      embed: deps.embed,
      nearest: async (embedding, limit, min) => {
        const { data, error: err } = await db.rpc('relevant_facts', {
          p_user: userId,
          p_embedding: JSON.stringify(embedding),
          p_limit: limit,
          p_min: min,
        });
        if (err) throw new Error(err.message);
        return (data ?? []) as FactRow[];
      },
    },
    [...batch.map((c) => c.text ?? c.url ?? ''), ...links.map((c) => c.text ?? c.url ?? '')].join(
      '\n',
    ),
    (factRows ?? []) as FactRow[],
    profile.ids,
  );

  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'sort_batch',
      tier: 'small',
      system: [SORT_BATCH_SYSTEM, withRelevant(profile.text, extra)],
      messages: [
        {
          role: 'user',
          content: buildSortMessage(ctx, [
            ...batch.map((c) => ({ id: c.id, text: c.text ?? '', url: c.url })),
            ...links.map((c) => {
              const p = c.payload as { article_text: string; link?: { title?: string | null } };
              return {
                id: c.id,
                text: c.text ?? '',
                url: c.url,
                article: { title: p.link?.title ?? null, text: p.article_text },
              };
            }),
          ]),
        },
      ],
      schema: SortResult,
      maxTokens: 8000,
      effort: 'low',
      background,
    },
  );
  if (!result.ok) {
    // Captures stay unsorted and are retried by the next batch.
    return {
      ok: false,
      error_code: result.error_code,
      message: result.message,
      sorted: 0,
      items: 0,
    };
  }

  const plan = planSort(
    batch.map((c) => c.id),
    result.data,
    {
      now,
      topics: topics.data ?? [],
      lists: lists.data ?? [],
      ideas: (ideas.data ?? []).map((i) => ({ id: i.id, title: i.title })),
    },
    links.map((c) => c.id),
    actx,
  );
  const { data: applied, error: applyError } = await db.rpc('apply_sort_batch', {
    p_user_id: userId,
    p_plan: plan,
  });
  if (applyError) throw new Error(`apply: ${applyError.message}`);

  // Memory: record when facts were last sent, add proposed facts, learn rules.
  // Best-effort: a failure here never undoes the sorting above.
  const usedIds = [...profile.ids, ...extra.map((f) => f.id)];
  if (usedIds.length) {
    await db.from('memory_facts').update({ last_used_at: now.toISOString() }).in('id', usedIds);
  }
  if (plan.facts.length) {
    await db.rpc('add_memory_facts', { p_user_id: userId, p_facts: plan.facts });
  }
  await db.rpc('learn_rules', { p_user_id: userId });
  const counts = applied as { items: number; captures: number; links: number; actions?: number };
  const parts = [`Sorted ${counts.captures} capture${counts.captures === 1 ? '' : 's'}`];
  if (counts.actions) parts.push(`${counts.actions} action${counts.actions === 1 ? '' : 's'}`);
  if (counts.links) parts.push(`summarised ${counts.links} link${counts.links === 1 ? '' : 's'}`);
  return {
    ok: true,
    error_code: null,
    message: `${parts.join(', ')}.`,
    sorted: counts.captures,
    items: counts.items,
  };
}
