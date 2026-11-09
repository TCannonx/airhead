import { bearer, type Caller } from '../_shared/caller.ts';
import { json } from '../_shared/http.ts';

export interface EvalHandlerDeps {
  caller: Caller;
  /** True on the live project, where this function does not exist. */
  isLive(): boolean;
  apiKey(): string | undefined;
  /** Runs (or skips, when nothing changed and not forced) the evaluation. */
  evaluate(force: boolean, apiKey: string): Promise<Response>;
}

/** POST /ai-eval (dev only, service key only): see index.ts. */
export async function handleEval(req: Request, d: EvalHandlerDeps): Promise<Response> {
  if (d.isLive() || req.method !== 'POST')
    return json({ ok: false, error_code: 'not_found', message: 'Not found.' }, 404);
  if (!(await d.caller.isService(bearer(req))))
    return json({ ok: false, error_code: 'unauthorized', message: 'Service only.' }, 401);
  const apiKey = d.apiKey();
  if (!apiKey) return json({ ok: false, error_code: 'not_configured', message: 'No AI key.' }, 503);
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  return d.evaluate(!!body.force, apiKey);
}
