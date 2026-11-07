import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { runScout } from './run.ts';
import { supabaseScoutStore } from './store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/**
 * POST /scout
 *   (signed in) { mode: 'run' }: "Scout now" on Today or Insights.
 *   (service key) { user_id }: the weekly run with its notification.
 * Own-data findings in code plus at most one AI call with capped web search.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await req.json().catch(() => ({}))) as { mode?: string; user_id?: string };
  let userId: string;
  let trigger: 'weekly' | 'manual' = 'manual';
  if (SERVICE_KEY && token === SERVICE_KEY && body.user_id) {
    userId = body.user_id;
    trigger = 'weekly';
  } else {
    const { data } = await db.auth.getUser(token);
    if (!data.user)
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
    if (body.mode !== 'run')
      return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
    userId = data.user.id;
  }
  const res = await runScout(userId, trigger, {
    store: supabaseScoutStore(db),
    ai: new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || 'missing' }),
    usage: supabaseUsageStore(db),
  });
  return json({
    ok: true,
    error_code: null,
    message: res.cards
      ? `${res.cards} ${res.cards === 1 ? 'idea' : 'ideas'} ready.`
      : 'Nothing new to suggest right now.',
    ...res,
  });
});
