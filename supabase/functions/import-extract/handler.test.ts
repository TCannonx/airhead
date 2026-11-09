import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { AIClient } from '../_shared/ai.ts';
import {
  assertPreflight,
  badJson,
  fakeAI,
  fakeCaller,
  noAI,
  outcome,
  post,
  request,
  SERVICE,
  TOKEN_A,
  USER_A,
  USER_B,
  usage,
} from '../_shared/testing.ts';
import { handleImport } from './handler.ts';

const fetchDeps = {
  fetch: () =>
    Promise.resolve(
      new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
        headers: { 'content-type': 'text/calendar' },
      }),
    ),
  resolve: () => Promise.resolve(['93.184.216.34']),
};
const d = (ai: AIClient, apiKey = 'key') => ({
  caller: fakeCaller,
  apiKey: () => apiKey,
  ai: () => ai,
  usage,
  fetch: fetchDeps,
});
const TEXT = { kind: 'text', text: 'Sat 3 May 14:00 Dublin v Kerry', instruction: '' };

Deno.test('import-extract: preflight, method, missing or service token', async () => {
  const { ai, calls } = noAI();
  await assertPreflight(await handleImport(request('OPTIONS'), d(ai)));
  assertEquals(await outcome(await handleImport(request('GET', TOKEN_A), d(ai))), [
    405,
    'method_not_allowed',
  ]);
  assertEquals(await outcome(await handleImport(post(TEXT), d(ai))), [401, 'unauthorized']);
  assertEquals(await outcome(await handleImport(post(TEXT, SERVICE), d(ai))), [
    401,
    'unauthorized',
  ]);
  assertEquals(calls.length, 0);
});

Deno.test('import-extract: no key → 503 except for links (no AI); bad JSON → 400', async () => {
  const { ai, calls } = noAI();
  assertEquals(await outcome(await handleImport(post(TEXT, TOKEN_A), d(ai, ''))), [
    503,
    'not_configured',
  ]);
  // An .ics link needs no AI, so it works without a key.
  assertEquals(
    await outcome(
      await handleImport(
        post({ kind: 'link', url: 'https://x.example/a.ics' }, TOKEN_A),
        d(ai, ''),
      ),
    ),
    [200, null],
  );
  // Unreadable JSON is an empty request: refused before any AI call.
  assertEquals(await outcome(await handleImport(badJson(TOKEN_A), d(ai))), [400, 'bad_request']);
  assertEquals(calls.length, 0);
});

Deno.test('import-extract: runs for the token’s user, whatever the body says', async () => {
  const { ai } = fakeAI({ events: [], skipped_note: null });
  const users: string[] = [];
  const res = await handleImport(post({ ...TEXT, user_id: USER_B }, TOKEN_A), {
    ...d(ai),
    usage: { ...usage, record: (r) => (users.push(r.user_id), Promise.resolve()) },
  });
  assertEquals(await outcome(res), [200, null]);
  assertEquals(users, [USER_A]);
});
