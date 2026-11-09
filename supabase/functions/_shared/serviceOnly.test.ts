// Handler tests for the service-only functions: a user token, no token or a
// wrong key is refused before anything runs.
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { handleEval } from '../ai-eval/handler.ts';
import { handleEmbed } from '../embed-items/handler.ts';
import { handleTick } from '../scheduler-tick/handler.ts';
import type { Pusher } from './push.ts';
import { badJson, fakeCaller, outcome, post, request, SERVICE, TOKEN_A } from './testing.ts';

const pusher: Pusher = {
  publicKey: () => Promise.resolve('k'),
  send: () => Promise.resolve('sent'),
};

const cases: { name: string; handle: (req: Request, ran: string[]) => Promise<Response> }[] = [
  {
    name: 'embed-items',
    handle: (req, ran) =>
      handleEmbed(req, {
        caller: fakeCaller,
        embed: () => (ran.push('embed'), Promise.resolve({ items: 0 })),
      }),
  },
  {
    name: 'scheduler-tick',
    handle: (req, ran) =>
      handleTick(req, {
        caller: fakeCaller,
        pusher: () => Promise.resolve(pusher),
        tick: () => (ran.push('tick'), Promise.resolve({ sent: 0 })),
      }),
  },
  {
    name: 'ai-eval',
    handle: (req, ran) =>
      handleEval(req, {
        caller: fakeCaller,
        isLive: () => false,
        apiKey: () => 'key',
        evaluate: () => (ran.push('eval'), Promise.resolve(new Response('{}'))),
      }),
  },
];

for (const c of cases) {
  Deno.test(`${c.name}: service only; a user token or no token is refused`, async () => {
    const ran: string[] = [];
    for (const token of [undefined, TOKEN_A, 'sb_secret_wrong-key-0123456789'])
      assertEquals(await outcome(await c.handle(post({}, token), ran)), [401, 'unauthorized']);
    assertEquals(ran, []);
    const res = await c.handle(post({}, SERVICE), ran);
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(ran.length, 1);
  });
}

Deno.test('scheduler-tick: no push keys → 200 not_configured, nothing runs', async () => {
  const ran: string[] = [];
  const res = await handleTick(post({}, SERVICE), {
    caller: fakeCaller,
    pusher: () => Promise.resolve(null),
    tick: () => (ran.push('tick'), Promise.resolve({})),
  });
  assertEquals([await outcome(res), ran], [[200, 'not_configured'], []]);
});

Deno.test('ai-eval: not on live, POST only, needs a key; bad JSON is not forced', async () => {
  const forced: boolean[] = [];
  const deps = (live: boolean, key = 'key') => ({
    caller: fakeCaller,
    isLive: () => live,
    apiKey: () => key,
    evaluate: (force: boolean) => (forced.push(force), Promise.resolve(new Response('{}'))),
  });
  assertEquals(await outcome(await handleEval(post({}, SERVICE), deps(true))), [404, 'not_found']);
  assertEquals(await outcome(await handleEval(request('GET', SERVICE), deps(false))), [
    404,
    'not_found',
  ]);
  assertEquals(await outcome(await handleEval(post({}, SERVICE), deps(false, ''))), [
    503,
    'not_configured',
  ]);
  await (await handleEval(badJson(SERVICE), deps(false))).body?.cancel();
  await (await handleEval(post({ force: true }, SERVICE), deps(false))).body?.cancel();
  assertEquals(forced, [false, true]);
});
