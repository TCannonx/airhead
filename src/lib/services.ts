import { createClient } from '@supabase/supabase-js';
import { webAuthnAppLock } from './applock/webauthn';
import { localServices } from './auth/localAuth';
import { supabaseAuth } from './auth/supabaseAuth';
import { supabaseUsage } from './ai/supabaseUsage';
import { supabaseCalendars } from './calendar/supabaseCalendars';
import { supabaseImports } from './import/supabaseImports';
import { supabaseMemory } from './memory/supabaseMemory';
import { supabaseSorting } from './sort/supabaseSorting';
import { supabaseRemote } from './sync/supabaseRemote';
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
  return {
    auth: supabaseAuth(supabase),
    appLock: webAuthnAppLock,
    remote: supabaseRemote(supabase),
    sorting: supabaseSorting(supabase),
    usage: supabaseUsage(supabase),
    memory: supabaseMemory(supabase),
    calendars: supabaseCalendars(supabase),
    imports: supabaseImports(supabase),
  };
}
