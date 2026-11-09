import { bearer, type Caller } from './caller.ts';
import { json } from './http.ts';

/**
 * The shared start of functions that the app calls with { mode } and the
 * scheduler calls with the service key and { user_id } (morning-brief,
 * weekly-review, scout). A user's call always runs for that user: a user_id in
 * their body is ignored. Returns the user and whether it is the scheduled run,
 * or the error response.
 */
export async function userOrService(
  req: Request,
  caller: Caller,
  mode: string,
): Promise<{ userId: string; scheduled: boolean } | Response> {
  const token = bearer(req);
  const body = (await req.json().catch(() => ({}))) as { mode?: string; user_id?: string };
  if ((await caller.isService(token)) && body.user_id)
    return { userId: body.user_id, scheduled: true };
  const userId = await caller.userId(token);
  if (!userId)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  if (body.mode !== mode)
    return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
  return { userId, scheduled: false };
}
