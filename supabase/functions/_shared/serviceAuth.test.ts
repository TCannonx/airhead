import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { isServiceToken, serviceKeys } from './serviceAuth.ts';

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
