import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1.0.19';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';
import { deliver, isSubscription, pusherFromEnv, type Pusher } from './push.ts';

const SUB = (endpoint: string) => ({
  endpoint,
  keys: { auth: 'x', p256dh: 'y' },
});

Deno.test('subscriptions must look like real push subscriptions', () => {
  assert(isSubscription(SUB('https://web.push.apple.com/abc')));
  assert(!isSubscription(SUB('http://insecure.test/x')));
  assert(!isSubscription({ endpoint: 'https://x.test' }));
  assert(!isSubscription(null));
});

Deno.test('delivers to each device and clears subscriptions that are gone', async () => {
  const results: Record<string, 'sent' | 'gone' | 'error'> = {
    'https://push.test/a': 'sent',
    'https://push.test/b': 'gone',
    'https://push.test/c': 'error',
  };
  const pusher: Pusher = {
    publicKey: () => Promise.resolve('k'),
    send: (sub) => Promise.resolve(results[sub.endpoint] ?? 'error'),
  };
  const cleared: string[] = [];
  const devices = ['a', 'b', 'c', 'none'].map((id) => ({
    id,
    user_id: 'u',
    receives_notifications: true,
    push_subscription: id === 'none' ? null : SUB(`https://push.test/${id}`),
  }));
  const res = await deliver(devices, { title: 'Hi' }, pusher, (id) => {
    cleared.push(id);
    return Promise.resolve();
  });
  assertEquals(res, { sent: 1, gone: 1, failed: 1 });
  assertEquals(cleared, ['b']);
});

Deno.test('without VAPID secrets there is no pusher', async () => {
  const env = new Map<string, string>();
  assertEquals(await pusherFromEnv({ get: (k: string) => env.get(k) } as Deno.Env), null);
});

Deno.test('with VAPID keys: a public key for the browser, and 404/410 count as gone', async () => {
  const keys = await webpush.generateVapidKeys({ extractable: true });
  const env = new Map([
    ['VAPID_KEYS', JSON.stringify(await webpush.exportVapidKeys(keys))],
    ['VAPID_SUBJECT', 'mailto:test@example.com'],
  ]);
  const pusher = await pusherFromEnv({ get: (k: string) => env.get(k) } as Deno.Env);
  assert(pusher);
  // 65-byte uncompressed P-256 point, base64url: 87 characters.
  assertMatch(await pusher.publicKey(), /^[A-Za-z0-9_-]{87}$/);

  // A real subscription's keys (from a browser), with the push service faked.
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const p256dh = btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sub = {
    endpoint: 'https://push.example.test/send/abc',
    keys: { auth: 'AAAAAAAAAAAAAAAAAAAAAA', p256dh },
  };
  const realFetch = globalThis.fetch;
  try {
    for (const [status, expected] of [
      [201, 'sent'],
      [410, 'gone'],
      [404, 'gone'],
      [500, 'error'],
    ] as const) {
      const seen: Request[] = [];
      globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Request(input, init));
        return Promise.resolve(new Response(null, { status }));
      };
      assertEquals(await pusher.send(sub, { title: 'Test', tag: 'test' }), expected);
      assertEquals(seen[0]?.headers.get('content-encoding'), 'aes128gcm');
      assertMatch(seen[0]?.headers.get('authorization') ?? '', /^vapid t=/);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
