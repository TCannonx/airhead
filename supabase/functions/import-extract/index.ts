import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { handleImport } from './handler.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

async function resolve(host: string): Promise<string[]> {
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(host, 'A').catch(() => [] as string[]),
    Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...a, ...aaaa];
}

/** POST /import-extract: see handler.ts. */
Deno.serve((req) =>
  handleImport(req, {
    caller: supabaseCaller(db),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    ai: anthropicClient,
    usage: supabaseUsageStore(db),
    fetch: { fetch, resolve },
  }),
);
