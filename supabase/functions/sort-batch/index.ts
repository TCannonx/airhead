import { gteSmall } from '../_shared/embed.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleSortBatch } from './handler.ts';
import { runSortBatch } from './run.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/** POST /sort-batch: see handler.ts. */
Deno.serve((req) =>
  handleSortBatch(req, {
    caller: supabaseCaller(db, isService),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    sort: (userId, background, apiKey) =>
      runSortBatch(
        { db, ai: anthropicClient(apiKey), store: supabaseUsageStore(db), embed: gteSmall },
        userId,
        background,
      ),
  }),
);
