import { anthropicClient } from '../_shared/anthropic.ts';
import { json } from '../_shared/http.ts';
import { runEval } from './run.ts';

/**
 * POST /ai-eval (dev only): runs the owner's example requests through the real
 * sorting model and reports what each became. One small-tier call (about a
 * cent); writes nothing. Needs the `x-eval-token` header to match the
 * EVAL_TOKEN secret; without that secret the function does not exist.
 */
const LIVE_REF = 'qqobvcelbzhrcehqukrs';

Deno.serve(async (req) => {
  const token = Deno.env.get('EVAL_TOKEN') ?? '';
  const isLive = (Deno.env.get('SUPABASE_URL') ?? '').includes(LIVE_REF);
  if (!token || isLive || req.method !== 'POST')
    return json({ ok: false, error_code: 'not_found', message: 'Not found.' }, 404);
  if ((req.headers.get('x-eval-token') ?? '') !== token)
    return json({ ok: false, error_code: 'unauthorized', message: 'No.' }, 401);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ ok: false, error_code: 'not_configured', message: 'No AI key.' }, 503);
  try {
    return json({ ...(await runEval(anthropicClient(apiKey))) });
  } catch (error) {
    console.error('ai-eval failed', error);
    return json(
      { ok: false, error_code: 'server_error', message: String(error).slice(0, 300) },
      500,
    );
  }
});
