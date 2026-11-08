import { describe, expect, it, vi } from 'vitest';
import { FUNCTION_TIMEOUT_MS, limitFor, REQUEST_TIMEOUT_MS, timedFetch } from './timedFetch';

describe('timedFetch', () => {
  it('a request that never answers fails after its time limit', async () => {
    const stalled = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    const f = timedFetch(stalled as unknown as typeof fetch, () => 20);
    await expect(f('https://p.supabase.co/rest/v1/items')).rejects.toThrow('timed out');
  });

  it('answers in time pass straight through', async () => {
    const ok = vi.fn(async () => new Response('ok'));
    const f = timedFetch(ok as unknown as typeof fetch, () => 1000);
    expect(await (await f('https://x.test/')).text()).toBe('ok');
  });

  it("the caller's own abort still works", async () => {
    const stalled = (_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by caller'))),
      );
    const f = timedFetch(stalled as unknown as typeof fetch, () => 10_000);
    const c = new AbortController();
    const p = f('https://x.test/', { signal: c.signal });
    c.abort();
    await expect(p).rejects.toThrow('aborted by caller');
  });

  it('functions get longer than data requests', () => {
    expect(limitFor('https://p.supabase.co/functions/v1/sort-batch')).toBe(FUNCTION_TIMEOUT_MS);
    expect(limitFor('https://p.supabase.co/rest/v1/items?select=*')).toBe(REQUEST_TIMEOUT_MS);
  });
});
