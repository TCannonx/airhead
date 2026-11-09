import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { localNow } from '../scheduler-tick/notif.ts';
import { handleBrief } from './handler.ts';
import { runMorningBrief } from './run.ts';
import { supabaseBriefStore } from './store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/** POST /morning-brief: see handler.ts. */
Deno.serve((req) =>
  handleBrief(req, {
    caller: supabaseCaller(db, isService),
    async brief(userId, roundUp) {
      const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
      const store = supabaseBriefStore(db);
      const settings = await store.settings(userId);
      const tz = typeof settings.time_zone === 'string' ? settings.time_zone : 'Europe/Dublin';
      const now = new Date();
      return await runMorningBrief(
        userId,
        localNow(now, tz).date,
        now,
        { store, ai: anthropicClient(apiKey || 'missing'), usage: supabaseUsageStore(db) },
        { roundUp },
      );
    },
  }),
);
