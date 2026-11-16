import {
  type AIClient,
  callAI,
  callAIWithLookups,
  type Lookup,
  type UsageStore,
} from '../_shared/ai.ts';
import { readPlanSettings } from '../_shared/plan/defaults.ts';
import { buildPlanMessage, PLAN_SYSTEM, PLAN_VERSION } from '../_shared/prompts/plan.v2.ts';
import { PlanResult } from '../_shared/schemas/plan.ts';
import { addDays } from '../_shared/holidays/easter.ts';
import { buildPlanDigest, changedSince, type RawPlanDigest } from './digest.ts';
import { type ApplyPayload, validatePlan } from './validate.ts';

export type PlanMode = 'evening' | 'morning';
export type PlanRunStatus = 'ok' | 'failed' | 'cap_reached' | 'skipped';

/** Database access for one planner run (a fake in tests, Supabase in production). */
export interface PlanStore {
  /** Inserts the plan_runs row (status running); null when this run already happened today. */
  startRun(userId: string, kind: PlanMode, localDate: string): Promise<string | null>;
  settings(userId: string): Promise<Record<string, unknown>>;
  profile(userId: string): Promise<string>;
  digest(userId: string, localDate: string): Promise<RawPlanDigest>;
  /**
   * The last 3 day summaries, 2 weekly and 1 month summary before the evening
   * (Task 14.8). Optional for older fakes.
   */
  history?(userId: string, localDate: string): Promise<PlanHistory>;
  /** When the evening run for that date finished ok (Task 15.1); null when none did. */
  eveningFinishedAt?(userId: string, eveningDate: string): Promise<string | null>;
  /** Today's planning spend so far (plan_runs.cost_eur for the local date). */
  spentToday(userId: string, localDate: string): Promise<number>;
  /** public.apply_plan: one transaction; also closes the run as ok. */
  apply(
    runId: string,
    payload: ApplyPayload & { cost_eur: number; summary: object; lookups_used?: number },
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

export interface PlanHistory {
  days: { date: string; digest: string }[];
  weeks: { week_start: string; digest: string }[];
  month: { month: string; digest: string } | null;
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
  deps: {
    store: PlanStore;
    ai: AIClient;
    usage: UsageStore;
    /** History look-ups the model may call (Task 14.8); without them, one plain call. */
    lookups?: Record<string, Lookup>;
  },
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

    // The evening plans from tonight; the morning refresh (Task 15.1) plans from
    // last night's view of the week, only for what changed since that run.
    const evening = mode === 'morning' ? addDays(localDate, -1) : localDate;
    let raw = await deps.store.digest(userId, evening);
    if (mode === 'morning') {
      const since = (await deps.store.eveningFinishedAt?.(userId, evening)) ?? null;
      raw = changedSince(raw, since);
      if (since && !raw.items.length && !raw.linked.length) {
        return await done('skipped', { summary: { why: 'nothing changed since the evening' } });
      }
    }
    const { digest, left_out } = buildPlanDigest(raw, settings, now);
    const plannable = digest.items.filter((i) => i.kind !== 'linked').length;
    if (plannable === 0) {
      return await done('ok', {
        items_considered: 0,
        summary: { why: 'nothing to plan', left_out },
      });
    }

    const profile = await deps.store.profile(userId);
    const history = deps.store.history ? await deps.store.history(userId, localDate) : null;
    const request = {
      userId,
      task: 'plan_day',
      tier: 'small' as const,
      system: [PLAN_SYSTEM, profile ? `What you know about this person:\n${profile}` : ''],
      messages: [{ role: 'user' as const, content: buildPlanMessage(digest, history) }],
      schema: PlanResult,
      maxTokens: 8000,
      background: true,
    };
    const res = deps.lookups
      ? await callAIWithLookups(
          { client: deps.ai, store: deps.usage },
          { ...request, lookups: deps.lookups, maxLookups: 4 },
        )
      : { ...(await callAI({ client: deps.ai, store: deps.usage }, request)), lookupsUsed: 0 };
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
      lookups_used: res.lookupsUsed,
      summary: {
        prompt: PLAN_VERSION,
        mode,
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
