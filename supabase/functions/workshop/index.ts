import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { gteSmall } from '../_shared/embed.ts';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import type { FactRow } from '../_shared/memory.ts';
import { relevantFacts } from '../_shared/relevant.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleWorkshop } from './handler.ts';
import { DraftContent } from './run.ts';
import type { Turn, TurnDeps } from './turn.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

function depsFor(userId: string, apiKey: string): TurnDeps {
  return {
    ai: anthropicClient(apiKey),
    store: supabaseUsageStore(db),
    async load(itemId) {
      const { data: item } = await db
        .from('items')
        .select('id, title, body, data, capture_id')
        .eq('id', itemId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle();
      if (!item) return null;
      const capture = item.capture_id
        ? (
            await db
              .from('captures')
              .select('text, payload')
              .eq('id', item.capture_id)
              .eq('user_id', userId)
              .maybeSingle()
          ).data
        : null;
      const { data: facts } = await db
        .from('memory_facts')
        .select('id, text, last_used_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null);
      const { data: latest } = await db
        .from('drafts')
        .select('content')
        .eq('item_id', itemId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const article = (capture?.payload as Record<string, unknown> | undefined)?.article_text;
      const allFacts = (facts ?? []) as FactRow[];
      const relevant = await relevantFacts(
        {
          embed: gteSmall,
          nearest: async (embedding, limit, min) => {
            const { data, error } = await db.rpc('relevant_facts', {
              p_user: userId,
              p_embedding: JSON.stringify(embedding),
              p_limit: limit,
              p_min: min,
            });
            if (error) throw new Error(error.message);
            return (data ?? []) as FactRow[];
          },
        },
        [item.title, item.body ?? '', capture?.text ?? ''].join('\n'),
        allFacts,
        [],
      );
      const current = latest ? DraftContent.safeParse(latest.content) : null;
      return {
        item,
        captureText: capture?.text ?? null,
        pageText: typeof article === 'string' ? article : null,
        facts: allFacts,
        relevant,
        current: current?.success ? current.data : null,
      };
    },
    async saveDraft(itemId, content, source) {
      const { data, error } = await db
        .from('drafts')
        .insert({ id: crypto.randomUUID(), user_id: userId, item_id: itemId, content, source })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>;
    },
    async loadTurns(itemId) {
      const { data } = await db
        .from('workshop_sessions')
        .select('turns')
        .eq('id', itemId)
        .eq('user_id', userId)
        .maybeSingle();
      return Array.isArray(data?.turns) ? (data.turns as Turn[]) : [];
    },
    async saveTurns(itemId, turns) {
      const { data, error } = await db
        .from('workshop_sessions')
        .upsert({ id: itemId, user_id: userId, turns, pending: null, deleted_at: null })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>;
    },
    async markFactsUsed(ids) {
      await db
        .from('memory_facts')
        .update({ last_used_at: new Date().toISOString() })
        .in('id', ids);
    },
  };
}

/** POST /workshop: see handler.ts. */
Deno.serve((req) =>
  handleWorkshop(req, {
    caller: supabaseCaller(db),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    runDeps: depsFor,
  }),
);
