import { gteSmall } from '../_shared/embed.ts';
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { isServiceToken, SERVICE_KEYS } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { runSortBatch } from './run.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/**
 * POST /sort-batch
 * - from the app: Authorization: Bearer <user access token>   (on-demand: app open, "Sort now")
 * - from the scheduler: Authorization: Bearer <service key>, body { user_id }   (background)
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let userId: string | null = null;
  let background = false;
  if (isServiceToken(token, SERVICE_KEYS)) {
    const body = (await req.json().catch(() => ({}))) as { user_id?: string };
    userId = body.user_id ?? null;
    background = true;
  } else if (token) {
    const { data } = await db.auth.getUser(token);
    userId = data.user?.id ?? null;
  }
  if (!userId) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { ok: false, error_code: 'not_configured', message: 'AI sorting is not set up yet.' },
      503,
    );
  }

  try {
    const outcome = await runSortBatch(
      { db, ai: new Anthropic({ apiKey }), store: supabaseUsageStore(db), embed: gteSmall },
      userId,
      background,
    );
    return json(outcome, outcome.ok ? 200 : outcome.error_code === 'cap_reached' ? 402 : 502);
  } catch (error) {
    console.error('sort-batch failed', error);
    return json(
      { ok: false, error_code: 'server_error', message: 'Sorting failed. It will be tried again.' },
      500,
    );
  }
});
