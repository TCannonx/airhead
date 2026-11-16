import { z } from 'npm:zod@4.6.7';

/**
 * The evening planner's answer (Task 13.6, spec 2026-11-16-ai-brain §3).
 * Times are local wall times "YYYY-MM-DD HH:MM"; code turns them into instants
 * and checks every hard rule (plan-day/validate.ts). Fields are required with
 * empty values rather than optional, to keep the schema's union count low.
 */
export const PLAN_NUDGE_KINDS = ['prepare', 'leave', 'do', 'follow_up', 'reading'] as const;
export type PlanNudgeKind = (typeof PLAN_NUDGE_KINDS)[number];

export const PlanNudge = z.object({
  kind: z.enum(PLAN_NUDGE_KINDS),
  /** Local send time, "YYYY-MM-DD HH:MM". */
  at: z.string(),
  title: z.string(),
  body: z.string(),
  /** One line on why now. */
  reason: z.string(),
  delivery: z.enum(['push', 'digest']),
});

export const PlanItemResult = z.object({
  item_id: z.string(),
  /** The occurrence's local date, as in the digest. */
  occurrence_date: z.string(),
  /** When the item becomes actionable, "YYYY-MM-DD HH:MM", or "" for none. */
  surface_at: z.string(),
  /** Rough minutes, 0 when unknown. */
  effort_minutes: z.number(),
  needs: z.array(z.string()),
  prep: z.array(z.string()),
  nudges: z.array(PlanNudge),
  reason: z.string(),
  confidence: z.number(),
});

export const PlanResult = z.object({
  items: z.array(PlanItemResult),
  /** Things to prepare this evening, one short line each. */
  tonight: z.array(z.string()),
  clashes: z.array(z.object({ item_ids: z.array(z.string()), note: z.string() })),
  /** A short draft of tomorrow's morning digest. */
  digest_draft: z.string(),
});
export type PlanResultT = z.infer<typeof PlanResult>;
