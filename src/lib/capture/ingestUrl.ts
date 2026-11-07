import { configuredSupabaseUrl, normaliseSupabaseUrl } from '../supabaseUrl';

/** The address iOS Shortcuts post to, from the configured Supabase URL. */
export function ingestUrl(base = configuredSupabaseUrl()): string {
  return `${normaliseSupabaseUrl(base) ?? 'https://<your-project>.supabase.co'}/functions/v1/ingest-capture`;
}
