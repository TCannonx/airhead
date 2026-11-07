import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import type { FeedItem, FeedLeave, FeedWorkDay } from './feed.ts';
import { handleFeed, type FeedStore } from './handler.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** Reads with the service key, always filtered to the feed owner's rows. */
const store: FeedStore = {
  async findFeed(tokenHash) {
    const { data } = await db
      .from('feeds')
      .select('user_id, kind, enabled, deleted_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    return data;
  },
  async loadData(userId) {
    const [settings, items, leave, workDays] = await Promise.all([
      db.from('settings').select('data').eq('id', userId).maybeSingle(),
      db
        .from('items')
        .select(
          'id, type, title, body, data, status, start_at, end_at, all_day, rrule, calendar, updated_at, deleted_at',
        )
        .eq('user_id', userId)
        .in('type', ['event', 'task'])
        .not('start_at', 'is', null)
        .is('deleted_at', null),
      db
        .from('leave_bookings')
        .select(
          'id, start_date, end_date, start_half, end_half, leave_type, status, share_us, updated_at, deleted_at',
        )
        .eq('user_id', userId)
        .is('deleted_at', null),
      db
        .from('work_days')
        .select('date, location, deleted_at')
        .eq('user_id', userId)
        .is('deleted_at', null),
    ]);
    return {
      settings: (settings.data?.data as Record<string, unknown> | undefined) ?? {},
      items: (items.data ?? []) as FeedItem[],
      leave: (leave.data ?? []) as FeedLeave[],
      workDays: (workDays.data ?? []) as FeedWorkDay[],
    };
  },
};

/** GET /calendar-feed?t=<token>: public (no sign-in); the token is the key. */
Deno.serve((req) => handleFeed(req, store));
