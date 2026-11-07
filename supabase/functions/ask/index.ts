import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { runAsk } from './run.ts';

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

/**
 * POST /ask { question }
 * Signed in only. Search runs as the user (RLS); one AI call answers from the
 * top 8 passages, with citations.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey)
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  const userId = auth.user.id;
  const asUser = createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  const outcome = await runAsk(typeof body.question === 'string' ? body.question : '', userId, {
    ai: new Anthropic({ apiKey }),
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
      const { data } = await asUser.from('settings').select('data').eq('id', userId).maybeSingle();
      return (data?.data as Record<string, unknown> | undefined)?.ask_model === 'large'
        ? 'large'
        : 'small';
    },
  }).catch(() => ({
    ok: false as const,
    error_code: 'api_error',
    message: 'Airhead couldn’t answer that just now. Try again.',
  }));
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
});
