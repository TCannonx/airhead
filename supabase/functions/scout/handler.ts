import type { Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { userOrService } from '../_shared/userOrService.ts';

export interface ScoutHandlerDeps {
  caller: Caller;
  /** runScout for this user. */
  scout(
    userId: string,
    trigger: 'weekly' | 'manual',
  ): Promise<{ cards: number; queries: string[]; searches: number }>;
}

/**
 * POST /scout
 *   (signed in) { mode: 'run' }: "Scout now" on Today or Insights.
 *   (service key) { user_id }: the weekly run with its notification.
 * Own-data findings in code plus at most one AI call with capped web search.
 */
export async function handleScout(req: Request, d: ScoutHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const who = await userOrService(req, d.caller, 'run');
  if (who instanceof Response) return who;
  const res = await d.scout(who.userId, who.scheduled ? 'weekly' : 'manual');
  return json({
    ok: true,
    error_code: null,
    message: res.cards
      ? `${res.cards} ${res.cards === 1 ? 'idea' : 'ideas'} ready.`
      : 'Nothing new to suggest right now.',
    ...res,
  });
}
