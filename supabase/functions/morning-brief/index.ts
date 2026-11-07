import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { localNow } from '../scheduler-tick/notif.ts';
import { runMorningBrief } from './run.ts';
import { supabaseBriefStore } from './store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/**
 * POST /morning-brief
 *   (signed in) { mode: 'regenerate' }: rebuild today's brief now (Settings → Today).
 *   (service key) { user_id }: the scheduled brief with its round-up notification.
 * One large-tier AI call at most; failures fall back to the code-built list.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await req.json().catch(() => ({}))) as { mode?: string; user_id?: string };
  let userId: string | null = null;
  let roundUp = false;
  if (SERVICE_KEY && token === SERVICE_KEY && body.user_id) {
    userId = body.user_id;
    roundUp = true;
  } else {
    const { data } = await db.auth.getUser(token);
    if (!data.user)
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
    if (body.mode !== 'regenerate') {
      return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
    }
    userId = data.user.id;
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const store = supabaseBriefStore(db);
  const settings = await store.settings(userId);
  const tz = typeof settings.time_zone === 'string' ? settings.time_zone : 'Europe/Dublin';
  const now = new Date();
  const res = await runMorningBrief(
    userId,
    localNow(now, tz).date,
    now,
    { store, ai: new Anthropic({ apiKey: apiKey || 'missing' }), usage: supabaseUsageStore(db) },
    { roundUp },
  );
  if (res.status === 'skipped') {
    return json({
      ok: true,
      error_code: null,
      message: 'Nothing planned today, so no brief.',
      status: res.status,
    });
  }
  return json({
    ok: true,
    error_code: null,
    status: res.status,
    message:
      res.status === 'ok'
        ? 'Your brief is ready.'
        : 'The AI brief wasn’t available, so here is a simple list instead.',
  });
});
