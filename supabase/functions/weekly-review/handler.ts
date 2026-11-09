import type { Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { userOrService } from '../_shared/userOrService.ts';

export interface ReviewHandlerDeps {
  caller: Caller;
  /** runWeeklyReview for last week in this user's time zone (notify = the scheduled run). */
  review(userId: string, notify: boolean): Promise<{ status: string; week_start: string }>;
}

/**
 * POST /weekly-review
 *   (signed in) { mode: 'run' }: review last week now (Insights → Run now).
 *   (service key) { user_id }: the scheduled review with its notification.
 * One large-tier call at most; failures store a numbers-only review.
 */
export async function handleReview(req: Request, d: ReviewHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const who = await userOrService(req, d.caller, 'run');
  if (who instanceof Response) return who;
  const review = await d.review(who.userId, who.scheduled);
  return json({
    ok: true,
    error_code: null,
    message:
      review.status === 'ok'
        ? 'Weekly review ready.'
        : 'Saved the numbers; the AI part can be tried again later.',
    status: review.status,
    week_start: review.week_start,
  });
}
