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

/** Service keys of the running function. */
export const SERVICE_KEYS = serviceKeys((name) => Deno.env.get(name));
