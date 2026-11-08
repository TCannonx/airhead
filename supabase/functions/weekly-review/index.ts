import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { isServiceToken, SERVICE_KEYS } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { localNow } from '../scheduler-tick/notif.ts';
import { lastWeekStart, runWeeklyReview } from './run.ts';
import { supabaseReviewStore } from './store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/**
 * POST /weekly-review
 *   (signed in) { mode: 'run' }: review last week now (Insights → Run now).
 *   (service key) { user_id }: the scheduled review with its notification.
 * One large-tier call at most; failures store a numbers-only review.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await req.json().catch(() => ({}))) as { mode?: string; user_id?: string };
  let userId: string;
  let notify = false;
  if (isServiceToken(token, SERVICE_KEYS) && body.user_id) {
    userId = body.user_id;
    notify = true;
  } else {
    const { data } = await db.auth.getUser(token);
    if (!data.user)
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
    if (body.mode !== 'run')
      return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
    userId = data.user.id;
  }
  const { data: s } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
  const tz =
    typeof s?.data?.time_zone === 'string' ? (s.data.time_zone as string) : 'Europe/Dublin';
  const weekStart = lastWeekStart(localNow(new Date(), tz).date);
  const review = await runWeeklyReview(
    userId,
    weekStart,
    {
      store: supabaseReviewStore(db),
      ai: new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || 'missing' }),
      usage: supabaseUsageStore(db),
    },
    { notify },
  );
  return json({
    ok: true,
    error_code: null,
    message:
      review.status === 'ok'
        ? 'Weekly review ready.'
        : 'Saved the numbers; the AI part can be tried again later.',
    status: review.status,
    week_start: weekStart,
  });
});
