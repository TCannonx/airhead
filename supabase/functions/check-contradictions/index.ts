import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { callAI } from '../_shared/ai.ts';
import { cors, json } from '../_shared/http.ts';
import {
  buildContradictionsMessage,
  CONTRADICTIONS_SYSTEM,
} from '../_shared/prompts/contradictions.v1.ts';
import { supabaseUsageStore } from '../_shared/usageStore.ts';
import { ContradictionsResult, validConflicts } from './check.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** POST /check-contradictions: one small-tier call over the user's active facts (on demand). */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  }

  const { data: facts } = await db
    .from('memory_facts')
    .select('id, text')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (!facts || facts.length < 2) {
    return json({
      ok: true,
      error_code: null,
      message: 'Not enough facts to compare.',
      conflicts: [],
    });
  }

  const result = await callAI(
    { client: new Anthropic({ apiKey }), store: supabaseUsageStore(db) },
    {
      userId,
      task: 'check_contradictions',
      tier: 'small',
      system: CONTRADICTIONS_SYSTEM,
      messages: [{ role: 'user', content: buildContradictionsMessage(facts) }],
      schema: ContradictionsResult,
      maxTokens: 4000,
      effort: 'low',
      background: false,
    },
  );
  if (!result.ok) {
    return json(
      { ok: false, error_code: result.error_code, message: result.message, conflicts: [] },
      502,
    );
  }
  const conflicts = validConflicts(
    result.data,
    facts.map((f) => f.id),
  );
  return json({
    ok: true,
    error_code: null,
    message: conflicts.length
      ? `Found ${conflicts.length} possible contradiction${conflicts.length === 1 ? '' : 's'}.`
      : 'No contradictions found.',
    conflicts,
  });
});
