import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { cors, json } from '../_shared/http.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { runSummarise, type SummariseRequest } from './run.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/**
 * POST /summarise-note { kind, title, date, attendees, html | images }
 * Signed in only. One large-tier call (vision for handwritten pages, rendered
 * on the device). Returns the summary; the device stores it on the note.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey)
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  const body = (await req.json().catch(() => ({}))) as SummariseRequest;
  const outcome = await runSummarise(body, auth.user.id, {
    ai: anthropicClient(apiKey),
    store: supabaseUsageStore(db),
  });
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
});
