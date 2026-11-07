import { ICS_OPTIONS, safeFetch, type SafeFetchDeps } from '../read-link/safeFetch.ts';
import { isCalendarText, parseCalendar, type Occurrence } from './parse.ts';

/** A linked calendar row (feeds.kind = 'linked_in'). */
export interface LinkedFeed {
  id: string;
  user_id: string;
  url: string;
}

export interface ExternalRow extends Occurrence {
  user_id: string;
  feed_id: string;
  deleted_at: null;
}

/** Database access, so the sync can be tested with a fake. */
export interface LinkedStore {
  /** Live (keys → row ids) occurrences already stored for a feed. */
  existingKeys(feedId: string): Promise<Map<string, string>>;
  upsert(rows: ExternalRow[]): Promise<void>;
  softDelete(ids: string[]): Promise<void>;
  markFeed(
    feedId: string,
    patch: { last_fetched_at?: string; last_error: string | null },
  ): Promise<void>;
}

/** webcal:// is https:// for fetching (calendar apps use it to mean "subscribe"). */
export const normaliseUrl = (url: string) => url.trim().replace(/^webcals?:\/\//i, 'https://');

export type FetchResult = { ok: true; text: string } | { ok: false; error: string };

export async function fetchCalendar(url: string, deps: SafeFetchDeps): Promise<FetchResult> {
  const res = await safeFetch(normaliseUrl(url), deps, ICS_OPTIONS);
  if (res.status === 'blocked') return { ok: false, error: 'That address isn’t allowed.' };
  if (res.status === 'too_large')
    return { ok: false, error: 'That calendar is too big (over 5 MB).' };
  if (res.status === 'not_html') return { ok: false, error: 'That link didn’t return a calendar.' };
  if (res.status !== 'ok') return { ok: false, error: `Couldn’t fetch it (${res.reason}).` };
  if (!isCalendarText(res.html)) return { ok: false, error: 'That link didn’t return a calendar.' };
  return { ok: true, text: res.html };
}

/** Checks a pasted link before it is saved: fetches and parses, stores nothing. */
export async function validateLink(
  url: string,
  deps: SafeFetchDeps,
  now = new Date(),
): Promise<{ ok: true; name: string | null; count: number } | { ok: false; error: string }> {
  const fetched = await fetchCalendar(url, deps);
  if (!fetched.ok) return fetched;
  try {
    const parsed = parseCalendar(fetched.text, now);
    return { ok: true, name: parsed.name, count: parsed.occurrences.length };
  } catch {
    return { ok: false, error: 'That calendar couldn’t be read.' };
  }
}

const BATCH = 500;

/**
 * Fetches one linked calendar and brings external_events in line with it:
 * upsert by (feed, occurrence key), soft-delete what disappeared. On failure
 * the old events stay and the error is recorded on the feed.
 */
export async function syncFeed(
  feed: LinkedFeed,
  deps: SafeFetchDeps,
  store: LinkedStore,
  now = new Date(),
): Promise<{ ok: true; count: number; removed: number } | { ok: false; error: string }> {
  const fetched = await fetchCalendar(feed.url, deps);
  let occurrences: Occurrence[];
  if (!fetched.ok) {
    await store.markFeed(feed.id, { last_error: fetched.error });
    return fetched;
  }
  try {
    occurrences = parseCalendar(fetched.text, now).occurrences;
  } catch {
    const error = 'That calendar couldn’t be read.';
    await store.markFeed(feed.id, { last_error: error });
    return { ok: false, error };
  }

  const existing = await store.existingKeys(feed.id);
  const seen = new Set<string>();
  const rows: ExternalRow[] = [];
  for (const o of occurrences) {
    if (seen.has(o.occurrence_key)) continue;
    seen.add(o.occurrence_key);
    rows.push({ ...o, user_id: feed.user_id, feed_id: feed.id, deleted_at: null });
  }
  for (let i = 0; i < rows.length; i += BATCH) await store.upsert(rows.slice(i, i + BATCH));
  const gone = [...existing.entries()].filter(([k]) => !seen.has(k)).map(([, id]) => id);
  for (let i = 0; i < gone.length; i += BATCH) await store.softDelete(gone.slice(i, i + BATCH));
  await store.markFeed(feed.id, { last_fetched_at: now.toISOString(), last_error: null });
  return { ok: true, count: rows.length, removed: gone.length };
}
