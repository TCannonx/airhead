import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleScout } from './handler.ts';
import { runScout } from './run.ts';
import { supabaseScoutStore } from './store.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/** POST /scout: see handler.ts. */
Deno.serve((req) =>
  handleScout(req, {
    caller: supabaseCaller(db, isService),
    scout: (userId, trigger) =>
      runScout(userId, trigger, {
        store: supabaseScoutStore(db),
        ai: anthropicClient(Deno.env.get('ANTHROPIC_API_KEY') || 'missing'),
        usage: supabaseUsageStore(db),
      }),
  }),
);
