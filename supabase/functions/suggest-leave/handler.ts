import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { runSuggestLeave } from './run.ts';

export interface SuggestLeaveHandlerDeps {
  caller: Caller;
  apiKey(): string | undefined;
  ai(apiKey: string): AIClient;
  usage: UsageStore;
}

/** POST /suggest-leave { today, candidates, context } — signed in only; one small-tier call. */
export async function handleSuggestLeave(
  req: Request,
  d: SuggestLeaveHandlerDeps,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const userId = await d.caller.userId(bearer(req));
  if (!userId)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  const apiKey = d.apiKey();
  if (!apiKey)
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  const outcome = await runSuggestLeave(await req.json().catch(() => ({})), userId, {
    ai: d.ai(apiKey),
    store: d.usage,
  });
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
}
