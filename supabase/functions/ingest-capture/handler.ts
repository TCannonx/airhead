import { bearer } from '../_shared/caller.ts';
import { type IngestBody, type IngestDeps, runIngest } from './run.ts';

const text = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * POST /ingest-capture  Authorization: Bearer <capture token>
 * { text?, url?, image? (base64), image_type? }  →  plain-text reply.
 * Called by iOS Shortcuts only (no browser CORS: the bookmarklet uses /share).
 */
export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  if (req.method !== 'POST') return text('Use POST.', 405);
  const token = bearer(req).trim();
  const body = (await req.json().catch(() => ({}))) as IngestBody;
  const res = await runIngest(token, body, deps).catch(() => ({
    status: 500,
    message: 'Airhead couldn’t save that. Try again.',
  }));
  return text(res.message, res.status);
}
