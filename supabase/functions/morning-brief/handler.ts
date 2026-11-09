import type { Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { userOrService } from '../_shared/userOrService.ts';
import type { BriefRunResult } from './run.ts';

export interface BriefHandlerDeps {
  caller: Caller;
  /** runMorningBrief for this user's local today (roundUp = the scheduled run). */
  brief(userId: string, roundUp: boolean): Promise<BriefRunResult>;
}

/**
 * POST /morning-brief
 *   (signed in) { mode: 'regenerate' }: rebuild today's brief now (Settings → Today).
 *   (service key) { user_id }: the scheduled brief with its round-up notification.
 * One large-tier AI call at most; failures fall back to the code-built list.
 */
export async function handleBrief(req: Request, d: BriefHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const who = await userOrService(req, d.caller, 'regenerate');
  if (who instanceof Response) return who;
  const res = await d.brief(who.userId, who.scheduled);
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
}
