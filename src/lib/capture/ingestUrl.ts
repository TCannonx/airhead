/** The address iOS Shortcuts post to, from the configured Supabase URL. */
export function ingestUrl(base = import.meta.env.VITE_SUPABASE_URL as string | undefined): string {
  return `${(base ?? 'https://<your-project>.supabase.co').replace(/\/+$/, '')}/functions/v1/ingest-capture`;
}
