import type { Feed } from '../schemas/records';
import type { AirheadDb } from './db';
import { baseRecord, save, softDelete } from './repository';

/**
 * Outgoing calendar feeds (Task 4.8). The token is made on the device (32
 * random bytes) and only its SHA-256 is stored and synced, so the link can be
 * shown once and never read back from the server.
 */
export type OutgoingKind = 'us_out' | 'me_out';

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const FEED_NAMES: Record<OutgoingKind, string> = {
  us_out: 'Us',
  me_out: 'Everything (my phone)',
};

/** The live feed of a kind, if any. */
export async function outgoingFeed(db: AirheadDb, kind: OutgoingKind): Promise<Feed | undefined> {
  const rows = await db.feeds.where('kind').equals(kind).toArray();
  return rows.find((f) => !f.deleted_at);
}

/**
 * Creates the feed, or gives the existing one a new token (the old link stops
 * working once this syncs). Returns the token to show once.
 */
export async function issueFeedToken(
  db: AirheadDb,
  userId: string,
  kind: OutgoingKind,
): Promise<{ feed: Feed; token: string }> {
  const token = newToken();
  const token_hash = await sha256Hex(token);
  const existing = await outgoingFeed(db, kind);
  const feed: Feed = existing
    ? { ...existing, token_hash, enabled: true }
    : {
        ...baseRecord(userId),
        kind,
        name: FEED_NAMES[kind],
        colour: null,
        token_hash,
        url: null,
        enabled: true,
        settings: {},
        last_fetched_at: null,
        last_error: null,
      };
  return { feed: await save(db, 'feeds', feed), token };
}

/** Turns a feed off: its link returns "not found" once this syncs. */
export const revokeFeed = (db: AirheadDb, id: string) => softDelete(db, 'feeds', id);

/** https://…/functions/v1/calendar-feed?t=… for a token, or null without a server. */
export function feedUrl(
  token: string,
  base = import.meta.env.VITE_SUPABASE_URL as string | undefined,
) {
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/functions/v1/calendar-feed?t=${encodeURIComponent(token)}`;
}

/** The same link as webcal://, which opens the subscribe dialog in calendar apps. */
export const webcalUrl = (url: string) => url.replace(/^https?:\/\//, 'webcal://');
