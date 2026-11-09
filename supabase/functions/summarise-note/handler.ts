import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { runSummarise, type SummariseRequest } from './run.ts';

export interface SummariseHandlerDeps {
  caller: Caller;
  apiKey(): string | undefined;
  ai(apiKey: string): AIClient;
  usage: UsageStore;
}

/**
 * POST /summarise-note { kind, title, date, attendees, html | images }
 * Signed in only. One large-tier call (vision for handwritten pages, rendered
 * on the device). Returns the summary; the device stores it on the note.
 */
export async function handleSummarise(req: Request, d: SummariseHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const userId = await d.caller.userId(bearer(req));
  if (!userId)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  const apiKey = d.apiKey();
  if (!apiKey)
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  const body = (await req.json().catch(() => ({}))) as SummariseRequest;
  const outcome = await runSummarise(body, userId, { ai: d.ai(apiKey), store: d.usage });
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
}
