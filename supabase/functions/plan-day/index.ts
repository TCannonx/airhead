import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { localNow } from '../scheduler-tick/notif.ts';
import { handlePlan } from './handler.ts';
import { runPlanDay } from './run.ts';
import { supabasePlanStore } from './store.ts';
import { planLookups } from './lookups.ts';
import { supabaseHistoryStore } from '../_shared/history/store.ts';
import { gteSmall } from '../_shared/embed.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/** POST /plan-day: see handler.ts. */
Deno.serve((req) =>
  handlePlan(req, {
    caller: supabaseCaller(db, isService),
    async plan(userId, localDate) {
      const store = supabasePlanStore(db);
      const settings = await store.settings(userId);
      const tz = typeof settings.time_zone === 'string' ? settings.time_zone : 'Europe/Dublin';
      const now = new Date();
      return await runPlanDay(userId, localDate ?? localNow(now, tz).date, now, 'evening', {
        store,
        ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
        usage: supabaseUsageStore(db),
        lookups: planLookups(
          supabaseHistoryStore(db, (t) => gteSmall(t).catch(() => null)),
          userId,
        ),
      });
    },
  }),
);
