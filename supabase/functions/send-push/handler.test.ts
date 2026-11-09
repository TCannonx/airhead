import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { DeviceRow, Pusher } from '../_shared/push.ts';
import {
  assertPreflight,
  badJson,
  fakeCaller,
  outcome,
  post,
  request,
  SERVICE,
  TOKEN_A,
  TOKEN_B,
  USER_A,
  USER_B,
} from '../_shared/testing.ts';
import { handleSendPush } from './handler.ts';

const SUB = { endpoint: 'https://push.example/1', keys: { auth: 'a', p256dh: 'p' } };
const DEVICE_OF_A: DeviceRow = {
  id: 'dev-a',
  user_id: USER_A,
  push_subscription: SUB,
  receives_notifications: true,
};

function d(configured = true) {
  const sent: string[] = [];
  const pusher: Pusher = {
    publicKey: () => Promise.resolve('PUBLIC'),
    send: (_sub, payload) => (sent.push(payload.title), Promise.resolve('sent')),
  };
  const asked: string[] = [];
  return {
    sent,
    asked,
    deps: {
      caller: fakeCaller,
      pusher: () => Promise.resolve(configured ? pusher : null),
      notificationDevices: (userId: string) => {
        asked.push(userId);
        return Promise.resolve(userId === USER_A ? [DEVICE_OF_A] : []);
      },
      device: (id: string, userId: string) =>
        Promise.resolve(id === DEVICE_OF_A.id && userId === USER_A ? DEVICE_OF_A : null),
      clear: () => Promise.resolve(),
    },
  };
}

Deno.test(
  'send-push: preflight allows GET; the public key is public; not set up → 503',
  async () => {
    await assertPreflight(await handleSendPush(request('OPTIONS'), d().deps), 'GET, POST, OPTIONS');
    const res = await handleSendPush(request('GET'), d().deps);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).public_key, 'PUBLIC');
    assertEquals(await outcome(await handleSendPush(request('GET'), d(false).deps)), [
      503,
      'not_configured',
    ]);
    assertEquals(await outcome(await handleSendPush(request('PUT', TOKEN_A), d().deps)), [
      405,
      'method_not_allowed',
    ]);
  },
);

Deno.test('send-push: a test needs a signed-in user and their own device', async () => {
  const x = d();
  const test = { mode: 'test', device_id: DEVICE_OF_A.id };
  assertEquals(await outcome(await handleSendPush(post(test), x.deps)), [401, 'unauthorized']);
  assertEquals(await outcome(await handleSendPush(badJson(TOKEN_A), x.deps)), [400, 'bad_request']);
  // Another user's device id is not found (the lookup is limited to the caller).
  assertEquals(await outcome(await handleSendPush(post(test, TOKEN_B), x.deps)), [
    404,
    'not_found',
  ]);
  assertEquals(x.sent, []);
  assertEquals(await outcome(await handleSendPush(post(test, TOKEN_A), x.deps)), [200, null]);
  assertEquals(x.sent, ['Airhead']);
});

Deno.test('send-push: only the service may send to a named user', async () => {
  const x = d();
  const send = { user_id: USER_A, payload: { title: 'Hello' } };
  // A user token naming a user (even themselves) is not the service: no payload is sent.
  assertEquals(await outcome(await handleSendPush(post(send, TOKEN_B), x.deps)), [
    400,
    'bad_request',
  ]);
  assertEquals(await outcome(await handleSendPush(post(send), x.deps)), [401, 'unauthorized']);
  assertEquals(await outcome(await handleSendPush(post({ user_id: USER_A }, SERVICE), x.deps)), [
    400,
    'bad_request',
  ]);
  assertEquals(x.sent, []);
  assertEquals(await outcome(await handleSendPush(post(send, SERVICE), x.deps)), [200, null]);
  assertEquals(
    await outcome(await handleSendPush(post({ ...send, user_id: USER_B }, SERVICE), x.deps)),
    [200, 'not_delivered'],
  );
  assertEquals([x.sent, x.asked], [['Hello'], [USER_A, USER_B]]);
});
