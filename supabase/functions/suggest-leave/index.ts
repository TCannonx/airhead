import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleSuggestLeave } from './handler.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** POST /suggest-leave: see handler.ts. */
Deno.serve((req) =>
  handleSuggestLeave(req, {
    caller: supabaseCaller(db),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    ai: anthropicClient,
    usage: supabaseUsageStore(db),
  }),
);
