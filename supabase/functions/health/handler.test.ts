import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { handleHealth } from './handler.ts';

const ok = () => Promise.resolve();
const down = () => Promise.reject(new Error('connection refused'));

Deno.test('GET answers ok when the database responds', async () => {
  const res = await handleHealth(new Request('http://x/health'), ok);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.error_code, null);
  assertEquals(typeof body.time, 'string');
});

Deno.test('answers 503 with a plain message when the database is down', async () => {
  const res = await handleHealth(new Request('http://x/health'), down);
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error_code, 'db_unreachable');
  // Never leaks internal error text.
  assertEquals(String(body.message).includes('connection refused'), false);
});

Deno.test('rejects other methods', async () => {
  const res = await handleHealth(new Request('http://x/health', { method: 'POST' }), ok);
  assertEquals(res.status, 405);
  assertEquals((await res.json()).error_code, 'method_not_allowed');
});

Deno.test('HEAD is allowed (uptime pingers)', async () => {
  const res = await handleHealth(new Request('http://x/health', { method: 'HEAD' }), ok);
  assertEquals(res.status, 200);
});
