import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import type { ExtractRequest } from './extract.ts';
import { runImport } from './run.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

async function resolve(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}

/**
 * POST /import-extract { kind, text | data + media_type | url, instruction, today, time_zone }
 * Signed in only. One small-tier AI call at most (vision for images and scans),
 * through the gateway (logged, capped). Imported content is data, never instructions.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  const body = (await req.json().catch(() => ({}))) as ExtractRequest;
  if (!apiKey && body.kind !== 'link') {
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  }
  const outcome = await runImport(body, auth.user.id, {
    ai: new Anthropic({ apiKey: apiKey ?? 'missing' }),
    store: supabaseUsageStore(db),
    fetch: { fetch, resolve },
  });
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
});
