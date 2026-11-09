import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { localNow } from '../scheduler-tick/notif.ts';
import { handleReview } from './handler.ts';
import { lastWeekStart, runWeeklyReview } from './run.ts';
import { supabaseReviewStore } from './store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/** POST /weekly-review: see handler.ts. */
Deno.serve((req) =>
  handleReview(req, {
    caller: supabaseCaller(db, isService),
    async review(userId, notify) {
      const { data: s } = await db.from('settings').select('data').eq('id', userId).maybeSingle();
      const tz =
        typeof s?.data?.time_zone === 'string' ? (s.data.time_zone as string) : 'Europe/Dublin';
      const weekStart = lastWeekStart(localNow(new Date(), tz).date);
      const review = await runWeeklyReview(
        userId,
        weekStart,
        {
          store: supabaseReviewStore(db),
          ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
          usage: supabaseUsageStore(db),
        },
        { notify },
      );
      return { status: review.status, week_start: weekStart };
    },
  }),
);
