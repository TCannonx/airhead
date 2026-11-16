import { type AIClient, callAI, callAIWithLookups, type UsageStore } from '../_shared/ai.ts';
import { buildPlanMessage, PLAN_SYSTEM } from '../_shared/prompts/plan.v3.ts';
import { PlanResult } from '../_shared/schemas/plan.ts';
import { buildPlanDigest } from '../plan-day/digest.ts';
import { validatePlan } from '../plan-day/validate.ts';
import { planCases, planEvalNow } from './planCases.ts';
import type { CaseReport } from './run.ts';

/**
 * The planner cases (Task 13.9): one small-tier call per case, exactly as
 * plan-day makes it (same prompt, digest shaping and schema). The check reads
 * the model's own answer; what validation would drop is reported alongside.
 */
export async function runPlanEval(
  ai: AIClient,
  now: Date,
  store: UsageStore,
): Promise<{ ok: boolean; error: string | null; cost_eur: number; cases: CaseReport[] }> {
  const { at } = planEvalNow(now);
  const { cases, ids } = planCases(now);
  const reports: CaseReport[] = [];
  let cost = 0;
  for (const c of cases) {
    const { digest } = buildPlanDigest(c.raw, c.settings, at);
    const request = {
      userId: '00000000-0000-4000-8000-0000000000e1',
      task: 'plan_day',
      tier: 'small' as const,
      system: [
        PLAN_SYSTEM,
        c.profile
          ? `What you know about this person:
${c.profile}`
          : '',
      ],
      messages: [{ role: 'user' as const, content: buildPlanMessage(digest) }],
      schema: PlanResult,
      maxTokens: 8000,
      background: false,
    };
    const res = c.lookups
      ? await callAIWithLookups(
          { client: ai, store },
          { ...request, lookups: c.lookups, maxLookups: 4 },
        )
      : await callAI({ client: ai, store }, request);
    if (!res.ok) return { ok: false, error: res.error_code, cost_eur: cost, cases: [] };
    cost += Number.isFinite(res.costEur) ? res.costEur : 0;
    const problems = c.check(res.data, ids);
    const { dropped } = validatePlan(res.data, digest, c.settings, at);
    reports.push({
      id: c.id,
      kind: 'plan',
      text: c.text,
      meant: c.meant,
      pass: problems.length === 0,
      problems,
      got: {
        items: res.data.items.map((i) => ({
          item_id: i.item_id,
          prep: i.prep,
          nudges: i.nudges.map((n) => ({
            kind: n.kind,
            at: n.at,
            delivery: n.delivery,
            title: n.title,
          })),
          reason: i.reason,
        })),
        actions: [],
        updates: [],
        workshop: 0,
        follow_ups: [],
        dropped,
      },
    });
  }
  return { ok: true, error: null, cost_eur: cost, cases: reports };
}
