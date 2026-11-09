import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { anthropicClient } from '../_shared/anthropic.ts';
import { supabaseCaller } from '../_shared/caller.ts';
import { json } from '../_shared/http.ts';
import { SORT_BATCH_SYSTEM } from '../_shared/prompts/sort-batch.v7.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { textHash } from '../sort-batch/notes.ts';
import { evalCases } from './cases.ts';
import { handleEval } from './handler.ts';
import { runEval } from './run.ts';

/**
 * POST /ai-eval (dev only): runs the owner's example requests through the real
 * sorting model and saves what each became in ai_eval_runs. Called every 30
 * minutes by dispatch_ai_eval (service key). The model is called only when the
 * prompt or the cases changed since the last saved run, or once a day; `force`
 * in the body runs it anyway. Writes nothing else.
 */
const LIVE_REF = 'qqobvcelbzhrcehqukrs';
const DAY = 86_400_000;

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** Changes when the sorting prompt or the evaluation cases change. */
export function promptHash(): string {
  const cases = evalCases(new Date('2026-01-05T12:00:00Z')).cases.map((c) => [
    c.id,
    c.text,
    c.meant,
  ]);
  return textHash(SORT_BATCH_SYSTEM + JSON.stringify(cases));
}

async function evaluate(force: boolean, apiKey: string): Promise<Response> {
  const hash = promptHash();
  const { data: last } = await db
    .from('ai_eval_runs')
    .select('prompt_hash, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fresh = last && last.prompt_hash === hash && Date.now() - Date.parse(last.created_at) < DAY;
  if (fresh && !force)
    return json({ ok: true, error_code: null, message: 'Nothing changed since the last run.' });

  try {
    const report = await runEval(anthropicClient(apiKey));
    const { error: saveError } = await db.from('ai_eval_runs').insert({
      prompt_hash: hash,
      passed: report.passed,
      total: report.total,
      cost_eur: Number.isFinite(report.cost_eur) ? report.cost_eur : 0,
      report,
    });
    // Without a saved row the next half-hour would call the model again.
    if (saveError) throw new Error(`could not save the report: ${saveError.message}`);
    return json({ ...report, message: `${report.passed}/${report.total} passed.` });
  } catch (error) {
    console.error('ai-eval failed', error);
    return json(
      { ok: false, error_code: 'server_error', message: String(error).slice(0, 300) },
      500,
    );
  }
}

Deno.serve((req) =>
  handleEval(req, {
    caller: supabaseCaller(db, isService),
    isLive: () => (Deno.env.get('SUPABASE_URL') ?? '').includes(LIVE_REF),
    apiKey: () => Deno.env.get('ANTHROPIC_API_KEY'),
    evaluate,
  }),
);
