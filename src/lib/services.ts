import { createClient } from '@supabase/supabase-js';
import { localServices } from './auth/localAuth';
import { supabaseAuth, supabaseDevices } from './auth/supabaseAuth';
import type { Services } from './auth/types';

/** Real services when the Supabase env vars are set, otherwise local-only mode. */
export function createServices(): Services {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return localServices();

  const supabase = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return { auth: supabaseAuth(supabase), devices: supabaseDevices(supabase) };
}
