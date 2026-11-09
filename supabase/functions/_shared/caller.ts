import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';

/**
 * Who is calling a function: a signed-in user (their access token) or the
 * service (a service key, from the database's scheduled jobs). Handlers take
 * this as a dependency so their tests can use fakes; index.ts passes
 * `supabaseCaller`.
 */
export interface Caller {
  /** The signed-in user's id for this access token, or null. */
  userId(token: string): Promise<string | null>;
  /** True when the token is one of this project's service keys. */
  isService(token: string): Promise<boolean>;
}

/** The bearer token of a request ('' when there is none). */
export const bearer = (req: Request): string =>
  (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');

/**
 * The real caller check: Supabase Auth for users, the service keys for the
 * service (pass `isService` from serviceAuth.ts; user-only functions leave it out).
 */
export function supabaseCaller(
  db: SupabaseClient,
  isService: (token: string) => Promise<boolean> = () => Promise.resolve(false),
): Caller {
  return {
    async userId(token) {
      const { data } = await db.auth.getUser(token);
      return data.user?.id ?? null;
    },
    isService,
  };
}
