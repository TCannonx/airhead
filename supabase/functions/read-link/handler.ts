import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';

export interface LinkCapture {
  id: string;
  user_id: string;
  url: string | null;
  payload: unknown;
  kind: string;
}

export interface ReadLinkHandlerDeps {
  caller: Caller;
  /** The capture; with `owner`, only if it is that user's. */
  findCapture(id: string, owner: string | null): Promise<LinkCapture | null>;
  /** Reads the page safely and stores what the next sort batch needs. */
  read(capture: LinkCapture & { url: string }): Promise<{ status: string }>;
}

/**
 * POST /read-link { capture_id }
 * Called by the database when a link capture arrives (service key), or by the
 * capture's owner. Reads the page safely and stores what the next sort batch
 * needs to summarise it. Web content is data only: nothing here acts on it.
 */
export async function handleReadLink(req: Request, d: ReadLinkHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  const token = bearer(req);
  const body = (await req.json().catch(() => ({}))) as { capture_id?: string };
  if (!body.capture_id) {
    return json({ ok: false, error_code: 'bad_request', message: 'capture_id is required.' }, 400);
  }

  let ownerFilter: string | null = null;
  if (!(await d.caller.isService(token))) {
    ownerFilter = await d.caller.userId(token);
    if (!ownerFilter)
      return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  }

  const capture = await d.findCapture(body.capture_id, ownerFilter);
  if (!capture?.url || capture.kind !== 'link') {
    return json({ ok: false, error_code: 'not_found', message: 'No link to read.' }, 404);
  }

  const info = await d.read({ ...capture, url: capture.url });
  return json({
    ok: true,
    error_code: null,
    message: info.status === 'unreadable' ? "Couldn't read this page." : 'Link read.',
    status: info.status,
  });
}
