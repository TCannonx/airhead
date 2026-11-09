import { bearer, type Caller } from '../_shared/caller.ts';
import { json } from '../_shared/http.ts';

export interface EmbedHandlerDeps {
  caller: Caller;
  /** runEmbed over the queue; returns its counts. */
  embed(): Promise<object>;
}

/**
 * POST /embed-items (service role only; called every 5 minutes by
 * dispatch_embed_items while anything is queued).
 */
export async function handleEmbed(req: Request, d: EmbedHandlerDeps): Promise<Response> {
  if (!(await d.caller.isService(bearer(req))))
    return json({ ok: false, error_code: 'unauthorized', message: 'Service only.' }, 401);
  const stats = await d.embed();
  return json({ ok: true, error_code: null, message: 'Embedded.', ...stats });
}
