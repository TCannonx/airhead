import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleAsk } from './handler.ts';

const URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const admin = createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
});

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, opts: Record<string, unknown>): Promise<unknown>;
    };
  };
};
let session: { run(input: string, opts: Record<string, unknown>): Promise<unknown> } | null = null;

/** POST /ask { question }: see handler.ts. */
Deno.serve((req) =>
  handleAsk(req, {
    caller: supabaseCaller(admin),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    runDeps(userId, token, apiKey) {
      const asUser = createClient(URL, ANON, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      return {
        ai: anthropicClient(apiKey),
        store: supabaseUsageStore(admin),
        async embed(text) {
          session ??= new Supabase.ai.Session('gte-small');
          return (await session.run(text, { mean_pool: true, normalize: true })) as number[];
        },
        async search(question, embedding, count) {
          const { data, error } = await asUser.rpc('hybrid_search', {
            query_text: question,
            query_embedding: JSON.stringify(embedding),
            match_count: count,
          });
          if (error) throw new Error(error.message);
          return (data ?? []) as { item_id: string; content: string }[];
        },
        async pages(ids) {
          if (ids.length === 0) return [];
          const { data: links } = await asUser
            .from('page_items')
            .select('page_id')
            .in('item_id', ids)
            .is('deleted_at', null);
          const pageIds = [...new Set((links ?? []).map((l) => l.page_id as string))];
          if (!pageIds.length) return [];
          const { data } = await asUser
            .from('pages')
            .select('kind, name, summary, item_count')
            .in('id', pageIds)
            .eq('status', 'active')
            .is('deleted_at', null)
            .order('item_count', { ascending: false });
          return (data ?? []) as { kind: string; name: string; summary: string }[];
        },
        async items(ids) {
          if (ids.length === 0) return new Map();
          const { data } = await asUser
            .from('items')
            .select('id, title, type')
            .in('id', ids)
            .is('deleted_at', null);
          return new Map(
            (data ?? []).map((i) => [
              i.id as string,
              { title: i.title as string, type: i.type as string },
            ]),
          );
        },
        async tier() {
          const { data } = await asUser
            .from('settings')
            .select('data')
            .eq('id', userId)
            .maybeSingle();
          return (data?.data as Record<string, unknown> | undefined)?.ask_model === 'large'
            ? 'large'
            : 'small';
        },
      };
    },
  }),
);
