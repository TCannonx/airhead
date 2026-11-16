import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { readPlanSettings } from '../_shared/plan/defaults.ts';
import { buildPlanMessage, PLAN_SYSTEM, PLAN_VERSION } from '../_shared/prompts/plan.v1.ts';
import { PlanResult } from '../_shared/schemas/plan.ts';
import { buildPlanDigest, type RawPlanDigest } from './digest.ts';
import { type ApplyPayload, validatePlan } from './validate.ts';

export type PlanMode = 'evening';
export type PlanRunStatus = 'ok' | 'failed' | 'cap_reached' | 'skipped';

/** Database access for one planner run (a fake in tests, Supabase in production). */
export interface PlanStore {
  /** Inserts the plan_runs row (status running); null when this run already happened today. */
  startRun(userId: string, kind: PlanMode, localDate: string): Promise<string | null>;
  settings(userId: string): Promise<Record<string, unknown>>;
  profile(userId: string): Promise<string>;
  digest(userId: string, localDate: string): Promise<RawPlanDigest>;
  /** Today's planning spend so far (plan_runs.cost_eur for the local date). */
  spentToday(userId: string, localDate: string): Promise<number>;
  /** public.apply_plan: one transaction; also closes the run as ok. */
  apply(
    runId: string,
    payload: ApplyPayload & { cost_eur: number; summary: object },
  ): Promise<number>;
  /** Closes a run that did not apply a plan. */
  finish(
    runId: string,
    status: Exclude<PlanRunStatus, 'ok'> | 'ok',
    fields: {
      items_considered?: number;
      cost_eur?: number;
      error?: string | null;
      summary?: object;
    },
  ): Promise<void>;
}

export interface PlanRunResult {
  status: PlanRunStatus | 'already_ran';
  nudges_written: number;
  dropped: number;
}

/**
 * The evening planner (Task 13.6): digest → one small-tier call → validate →
 * apply in one transaction. Defaults written on save stand whenever this does
 * not run, is capped or fails.
 */
export async function runPlanDay(
  userId: string,
  localDate: string,
  now: Date,
  mode: PlanMode,
  deps: { store: PlanStore; ai: AIClient; usage: UsageStore },
): Promise<PlanRunResult> {
  const runId = await deps.store.startRun(userId, mode, localDate);
  if (!runId) return { status: 'already_ran', nudges_written: 0, dropped: 0 };
  const done = async (
    status: PlanRunStatus,
    fields: Parameters<PlanStore['finish']>[2] = {},
  ): Promise<PlanRunResult> => {
    await deps.store.finish(runId, status, fields);
    return { status, nudges_written: 0, dropped: 0 };
  };

  try {
    const settings = await deps.store.settings(userId);
    const plan = readPlanSettings(settings);
    if (!plan.enabled) return await done('skipped', { summary: { why: 'planner off' } });
    if ((await deps.store.spentToday(userId, localDate)) >= plan.daily_cap_eur) {
      return await done('cap_reached', { summary: { why: 'daily planning cap' } });
    }

    const { digest, left_out } = buildPlanDigest(
      await deps.store.digest(userId, localDate),
      settings,
      now,
    );
    const plannable = digest.items.filter((i) => i.kind !== 'linked').length;
    if (plannable === 0) {
      return await done('ok', {
        items_considered: 0,
        summary: { why: 'nothing to plan', left_out },
      });
    }

    const profile = await deps.store.profile(userId);
    const res = await callAI(
      { client: deps.ai, store: deps.usage },
      {
        userId,
        task: 'plan_day',
        tier: 'small',
        system: [PLAN_SYSTEM, profile ? `What you know about this person:\n${profile}` : ''],
        messages: [{ role: 'user', content: buildPlanMessage(digest) }],
        schema: PlanResult,
        maxTokens: 8000,
        background: true,
      },
    );
    if (!res.ok) {
      return await done(res.error_code === 'cap_reached' ? 'cap_reached' : 'failed', {
        items_considered: plannable,
        error: res.error_code,
      });
    }

    const { payload, dropped } = validatePlan(res.data, digest, settings, now);
    const written = await deps.store.apply(runId, {
      ...payload,
      cost_eur: res.costEur,
      summary: {
        prompt: PLAN_VERSION,
        items_considered: plannable,
        left_out,
        dropped,
        tonight: res.data.tonight,
        clashes: res.data.clashes,
        digest_draft: res.data.digest_draft,
      },
    });
    return { status: 'ok', nudges_written: written, dropped: dropped.length };
  } catch (e) {
    return await done('failed', { error: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}
