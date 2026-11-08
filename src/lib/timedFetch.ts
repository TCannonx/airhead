/**
 * fetch with a time limit. Without one, a request that stalls (common on
 * phones when the connection changes) never settles, and everything waiting on
 * it waits too: sync stopped pulling and Sort now did nothing (2026-11-08).
 * A stalled request now fails, and the caller's usual retry takes over.
 */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Edge Functions such as sorting a batch with AI can take a while. */
export const FUNCTION_TIMEOUT_MS = 150_000;
/** Photo uploads on a slow connection. */
export const UPLOAD_TIMEOUT_MS = 120_000;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function limitFor(url: string): number {
  if (url.includes('/functions/v1/')) return FUNCTION_TIMEOUT_MS;
  if (url.includes('/storage/v1/')) return UPLOAD_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}

export function timedFetch(
  base: typeof fetch = (...args) => fetch(...args),
  limit: (url: string) => number = limitFor,
): typeof fetch {
  return (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('The request timed out.', 'TimeoutError')),
      limit(urlOf(input)),
    );
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
    }
    return base(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}
