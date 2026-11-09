import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import type { SafeFetchDeps } from '../read-link/safeFetch.ts';
import type { ExtractRequest } from './extract.ts';
import { runImport } from './run.ts';

export interface ImportHandlerDeps {
  caller: Caller;
  apiKey(): string | undefined;
  ai(apiKey: string): AIClient;
  usage: UsageStore;
  fetch: SafeFetchDeps;
}

/**
 * POST /import-extract { kind, text | data + media_type | url, instruction, today, time_zone }
 * Signed in only. One small-tier AI call at most (vision for images and scans),
 * through the gateway (logged, capped). Imported content is data, never instructions.
 */
export async function handleImport(req: Request, d: ImportHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const userId = await d.caller.userId(bearer(req));
  if (!userId) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  }
  const apiKey = d.apiKey();
  const body = (await req.json().catch(() => ({}))) as ExtractRequest;
  if (!apiKey && body.kind !== 'link') {
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  }
  const outcome = await runImport(body, userId, {
    ai: d.ai(apiKey ?? 'missing'),
    store: d.usage,
    fetch: d.fetch,
  });
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
}
