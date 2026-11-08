/**
 * Which bearer tokens count as "the service" (the database's scheduled jobs and
 * the functions calling each other).
 *
 * Supabase hands every function the legacy `SUPABASE_SERVICE_ROLE_KEY` and,
 * on newer projects, `SUPABASE_SECRET_KEYS` (a JSON object of name → `sb_secret_…`).
 * The legacy key shown in the dashboard does not always equal the injected one,
 * so the Vault secret `service_role_key` may hold either kind.
 */
export function serviceKeys(env: (name: string) => string | undefined): string[] {
  const keys = [env('SUPABASE_SERVICE_ROLE_KEY') ?? ''];
  try {
    const secret: unknown = JSON.parse(env('SUPABASE_SECRET_KEYS') ?? '{}');
    if (secret && typeof secret === 'object')
      for (const value of Object.values(secret)) if (typeof value === 'string') keys.push(value);
  } catch {
    // Not set or not JSON: only the legacy key counts.
  }
  return keys.map((k) => k.trim()).filter((k) => k.length >= 20);
}

/** True when the token is one of the service keys. Empty tokens never match. */
export function isServiceToken(token: string | null | undefined, keys: string[]): boolean {
  const t = (token ?? '').trim();
  return t.length > 0 && keys.includes(t);
}

/** The `role` claim of a JWT, read without checking the signature (only to decide whether to ask). */
export function claimedRole(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return claims &&
      typeof claims === 'object' &&
      typeof (claims as { role?: unknown }).role === 'string'
      ? (claims as { role: string }).role
      : null;
  } catch {
    return null;
  }
}

/**
 * Builds the service check. A token that equals a known key passes at once.
 * Another `service_role` JWT or `sb_secret_` key (the dashboard's copy can differ
 * from the injected one) is shown to Supabase itself: `probe` must return true
 * only if Supabase accepts it as an admin key. Accepted tokens are remembered.
 * User tokens and anything else are refused without a probe.
 */
export function serviceCheck(
  keys: string[],
  probe: (token: string) => Promise<boolean>,
): (token: string | null | undefined) => Promise<boolean> {
  const verified = new Set<string>();
  return async (token) => {
    const t = (token ?? '').trim();
    if (!t) return false;
    if (isServiceToken(t, keys) || verified.has(t)) return true;
    if (!t.startsWith('sb_secret_') && claimedRole(t) !== 'service_role') return false;
    let ok = false;
    try {
      ok = await probe(t);
    } catch {
      ok = false;
    }
    if (ok) verified.add(t);
    return ok;
  };
}

/** Asks Supabase Auth's admin API whether it accepts the token as a service key. */
export function authAdminProbe(url: string, fetchFn: typeof fetch = fetch) {
  return async (token: string): Promise<boolean> => {
    if (!url) return false;
    const headers: Record<string, string> = { apikey: token };
    if (!token.startsWith('sb_')) headers.Authorization = `Bearer ${token}`;
    const r = await fetchFn(`${url.replace(/\/+$/, '')}/auth/v1/admin/users?page=1&per_page=1`, {
      headers,
    });
    await r.body?.cancel();
    return r.ok;
  };
}

/** Service keys of the running function. */
export const SERVICE_KEYS = serviceKeys((name) => Deno.env.get(name));

/** True when the bearer token is a service key of this project. */
export const isService = serviceCheck(
  SERVICE_KEYS,
  authAdminProbe(Deno.env.get('SUPABASE_URL') ?? ''),
);
