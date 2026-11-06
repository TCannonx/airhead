import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { handleHealth } from './handler.ts';

// Injected by Supabase into every Edge Function.
const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

Deno.serve((req) =>
  handleHealth(req, async () => {
    // A tiny real query (no rows returned) so the database registers activity.
    const { error } = await db.from('settings').select('id', { count: 'exact', head: true });
    if (error) throw error;
  }),
);
