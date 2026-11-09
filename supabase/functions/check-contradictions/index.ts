import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleContradictions } from './handler.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** POST /check-contradictions: see handler.ts. */
Deno.serve((req) =>
  handleContradictions(req, {
    caller: supabaseCaller(db),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    ai: anthropicClient,
    usage: supabaseUsageStore(db),
    async facts(userId) {
      const { data } = await db
        .from('memory_facts')
        .select('id, text')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null);
      return data;
    },
  }),
);
