import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import {
  authAdminProbe,
  claimedRole,
  isServiceToken,
  serviceCheck,
  serviceKeys,
} from './serviceAuth.ts';

const LEGACY = 'eyJlegacy-service-role-key-000000';
const SECRET = 'sb_secret_abcdefghijklmnopqrstuvwxyz';

const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test('the legacy key and every new secret key count as the service', () => {
  const keys = serviceKeys(
    envOf({
      SUPABASE_SERVICE_ROLE_KEY: LEGACY,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
    }),
  );
  assertEquals(keys, [LEGACY, SECRET]);
  assert(isServiceToken(LEGACY, keys));
  assert(isServiceToken(SECRET, keys));
  assert(isServiceToken(` ${SECRET}\n`, keys));
  assert(!isServiceToken('eyJsomething-else-entirely-0000', keys));
});

Deno.test('missing or broken settings never let an empty token through', () => {
  const none = serviceKeys(envOf({}));
  assertEquals(none, []);
  assert(!isServiceToken('', none));
  assert(!isServiceToken(undefined, none));
  const broken = serviceKeys(
    envOf({ SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: ' ' }),
  );
  assertEquals(broken, []);
  assert(!isServiceToken('', broken));
  const odd = serviceKeys(
    envOf({ SUPABASE_SECRET_KEYS: JSON.stringify({ a: 1, b: '', c: SECRET }) }),
  );
  assertEquals(odd, [SECRET]);
});

const jwt = (claims: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.sig`;

Deno.test('another service_role key is checked with Supabase once, then remembered', async () => {
  const other = jwt({ role: 'service_role', ref: 'p' });
  const asked: string[] = [];
  const check = serviceCheck([LEGACY], async (t) => {
    asked.push(t);
    return t === other;
  });
  assert(await check(LEGACY));
  assert(await check(other));
  assert(await check(other));
  assertEquals(asked, [other]);
  assert(!(await check(jwt({ role: 'service_role', ref: 'forged' }))));
});

Deno.test('user tokens and junk are refused without asking Supabase', async () => {
  let asked = 0;
  const check = serviceCheck([], async () => {
    asked++;
    return true;
  });
  assert(!(await check(jwt({ role: 'authenticated', sub: 'u1' }))));
  assert(!(await check('not-a-token')));
  assert(!(await check('')));
  assertEquals(asked, 0);
  assertEquals(claimedRole(jwt({ role: 'anon' })), 'anon');
  assertEquals(claimedRole('a.%%%.b'), null);
});

Deno.test(
  'a failing probe refuses; sb_secret keys are probed via the apikey header only',
  async () => {
    const failing = serviceCheck([], () => Promise.reject(new Error('offline')));
    assert(!(await failing(SECRET)));
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const probe = authAdminProbe('https://p.supabase.co/', (async (
      url: string,
      init: RequestInit,
    ) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    assert(await probe(SECRET));
    assertEquals(seen[0].url, 'https://p.supabase.co/auth/v1/admin/users?page=1&per_page=1');
    assertEquals(seen[0].headers, { apikey: SECRET });
    const denied = authAdminProbe(
      'https://p.supabase.co',
      (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
    );
    assert(!(await denied(LEGACY)));
    assert(!(await authAdminProbe('')(SECRET)));
  },
);
