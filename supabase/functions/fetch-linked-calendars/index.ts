import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { handleLinked } from './handler.ts';
import { syncFeed, validateLink, type LinkedFeed, type LinkedStore } from './sync.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

async function resolve(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}
const fetchDeps = { fetch, resolve };

const store: LinkedStore = {
  async existingKeys(feedId) {
    const keys = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await db
        .from('external_events')
        .select('id, occurrence_key')
        .eq('feed_id', feedId)
        .is('deleted_at', null)
        .order('id')
        .range(from, from + 999);
      for (const r of data ?? []) keys.set(r.occurrence_key as string, r.id as string);
      if (!data || data.length < 1000) break;
    }
    return keys;
  },
  async upsert(rows) {
    const { error } = await db
      .from('external_events')
      .upsert(rows, { onConflict: 'feed_id,occurrence_key' });
    if (error) throw new Error(error.message);
  },
  async softDelete(ids) {
    await db.from('external_events').update({ deleted_at: new Date().toISOString() }).in('id', ids);
  },
  async markFeed(feedId, patch) {
    await db.from('feeds').update(patch).eq('id', feedId);
  },
};

/** POST /fetch-linked-calendars: see handler.ts. */
Deno.serve((req) =>
  handleLinked(req, {
    caller: supabaseCaller(db, isService),
    validate: (url) => validateLink(url, fetchDeps),
    async feeds({ feedId, userId }) {
      let query = db
        .from('feeds')
        .select('id, user_id, url')
        .eq('kind', 'linked_in')
        .eq('enabled', true)
        .is('deleted_at', null)
        .not('url', 'is', null);
      if (feedId) query = query.eq('id', feedId);
      if (userId) query = query.eq('user_id', userId);
      else if (!feedId) query = query.limit(200);
      const { data } = await query;
      return (data ?? []) as LinkedFeed[];
    },
    sync: (feed) => syncFeed(feed, fetchDeps, store),
  }),
);
