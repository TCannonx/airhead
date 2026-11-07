import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { buildSortMessage, SORT_BATCH_SYSTEM } from '../_shared/prompts/sort-batch.v1.ts';
import { SortResult } from '../_shared/schemas/sort.ts';
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
  deps: { db: SupabaseClient; ai: AIClient; store: UsageStore; now?: Date },
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
  if (batch.length === 0) {
    return { ok: true, error_code: null, message: 'Nothing to sort.', sorted: 0, items: 0 };
  }

  const [settings, topics, lists, ideas, corrections] = await Promise.all([
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
  ]);
  const timeZone =
    ((settings.data?.data as { time_zone?: string } | undefined)?.time_zone as string) ||
    'Europe/Dublin';

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
  };

  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'sort_batch',
      tier: 'small',
      system: SORT_BATCH_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildSortMessage(
            ctx,
            batch.map((c) => ({ id: c.id, text: c.text ?? '', url: c.url })),
          ),
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
  );
  const { data: applied, error: applyError } = await db.rpc('apply_sort_batch', {
    p_user_id: userId,
    p_plan: plan,
  });
  if (applyError) throw new Error(`apply: ${applyError.message}`);
  const counts = applied as { items: number; captures: number };
  return {
    ok: true,
    error_code: null,
    message: `Sorted ${counts.captures} capture${counts.captures === 1 ? '' : 's'}.`,
    sorted: counts.captures,
    items: counts.items,
  };
}
