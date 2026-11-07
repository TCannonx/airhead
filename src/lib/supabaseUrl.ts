/**
 * The project's base address from VITE_SUPABASE_URL, tidied: spaces trimmed and
 * any trailing `/rest/v1` (the "Data API" address the dashboard shows) or slash
 * removed. A pasted `" https://x.supabase.co/rest/v1/"` made every sign-in 404.
 */
export function normaliseSupabaseUrl(raw: string | undefined | null): string | undefined {
  const url = (raw ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|functions)\/v1$/i, '')
    .replace(/\/+$/, '');
  return url || undefined;
}

export const configuredSupabaseUrl = () =>
  normaliseSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
