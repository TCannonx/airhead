import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { sha256Hex } from '../calendar-feed/handler.ts';
import { badJson, post, request, USER_A, USER_B } from '../_shared/testing.ts';
import { handleIngest } from './handler.ts';
import type { CaptureRow, IngestDeps } from './run.ts';

const CAPTURE_TOKEN = 'capture-token-of-user-a-0123456789';

async function d(fail = false) {
  const hash = await sha256Hex(CAPTURE_TOKEN);
  const rows: CaptureRow[] = [];
  const deps: IngestDeps = {
    lookup: (h) => Promise.resolve(h === hash ? { user_id: USER_A, allowed: true } : null),
    insert: (row) =>
      fail ? Promise.reject(new Error('db: secret')) : (rows.push(row), Promise.resolve()),
    upload: () => Promise.resolve(),
  };
  return { rows, deps };
}

const status = async (res: Response) => [res.status, await res.text()] as const;

Deno.test('ingest-capture: POST only, plain text, no CORS (Shortcuts only)', async () => {
  const { deps } = await d();
  const res = await handleIngest(request('GET'), deps);
  assertEquals(res.status, 405);
  assertEquals(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), null);
  await res.body?.cancel();
});

Deno.test('ingest-capture: a missing or unknown capture token is 401; nothing saved', async () => {
  const { deps, rows } = await d();
  assertEquals((await handleIngest(post({ text: 'milk' }), deps)).status, 401);
  assertEquals((await handleIngest(post({ text: 'milk' }, 'not-a-real-token'), deps)).status, 401);
  // A user's app access token is not a capture token.
  assertEquals(
    (await handleIngest(post({ text: 'milk' }, 'user-a-access-token'), deps)).status,
    401,
  );
  assertEquals(rows, []);
});

Deno.test('ingest-capture: bad JSON saves nothing; a user_id in the body is ignored', async () => {
  const { deps, rows } = await d();
  const [code] = await status(await handleIngest(badJson(CAPTURE_TOKEN), deps));
  assertEquals(code, 400);
  assertEquals(rows, []);
  const ok = await handleIngest(post({ text: 'buy milk', user_id: USER_B }, CAPTURE_TOKEN), deps);
  assertEquals(ok.status, 200);
  await ok.body?.cancel();
  assertEquals(
    rows.map((r) => [r.user_id, r.text]),
    [[USER_A, 'buy milk']],
  );
});

Deno.test('ingest-capture: a failure is a plain 500 without internal detail', async () => {
  const { deps } = await d(true);
  assertEquals(await status(await handleIngest(post({ text: 'milk' }, CAPTURE_TOKEN), deps)), [
    500,
    'Airhead couldn’t save that. Try again.',
  ]);
});
