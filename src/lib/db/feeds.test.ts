import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openUserDb, type AirheadDb } from './db';
import {
  feedUrl,
  issueFeedToken,
  newToken,
  outgoingFeed,
  revokeFeed,
  sha256Hex,
  webcalUrl,
} from './feeds';

const U = '11111111-1111-4111-8111-111111111111';
let db: AirheadDb;
beforeEach(async () => {
  db = openUserDb(`${U}-feeds`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await db.delete();
});

describe('outgoing feed tokens (Task 4.8)', () => {
  it('tokens are 32 random bytes, URL-safe', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
  });

  it('only the SHA-256 of the token is stored', async () => {
    const { feed, token } = await issueFeedToken(db, U, 'us_out');
    expect(feed.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(await db.feeds.toArray())).not.toContain(token);
    expect(feed).toMatchObject({ kind: 'us_out', name: 'Us', enabled: true });
  });

  it('a new link replaces the old token on the same feed', async () => {
    const first = await issueFeedToken(db, U, 'us_out');
    const second = await issueFeedToken(db, U, 'us_out');
    expect(second.feed.id).toBe(first.feed.id);
    expect(second.feed.token_hash).not.toBe(first.feed.token_hash);
    expect(await db.feeds.count()).toBe(1);
  });

  it('turning a feed off soft-deletes it; a new link then makes a fresh feed', async () => {
    const { feed } = await issueFeedToken(db, U, 'me_out');
    await revokeFeed(db, feed.id);
    expect(await outgoingFeed(db, 'me_out')).toBeUndefined();
    const again = await issueFeedToken(db, U, 'me_out');
    expect(again.feed.id).not.toBe(feed.id);
  });

  it('builds https and webcal links from the server address', () => {
    const url = feedUrl('abc_DEF-123', 'https://xyz.supabase.co/');
    expect(url).toBe('https://xyz.supabase.co/functions/v1/calendar-feed?t=abc_DEF-123');
    expect(webcalUrl(url ?? '')).toBe(
      'webcal://xyz.supabase.co/functions/v1/calendar-feed?t=abc_DEF-123',
    );
    expect(feedUrl('x', '')).toBeNull();
  });

  it('matches the SHA-256 the server computes', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
