import { z } from 'npm:zod@4.6.7';
import { callAI, type AIClient, type UsageStore } from '../_shared/ai.ts';
import { buildReviewMessage, REVIEW_SYSTEM } from '../_shared/prompts/review.v1.ts';

export interface Candidate {
  kind: 'item' | 'capture';
  id: string;
  item_type: string | null;
  title: string;
  reason: string;
  mode: 'auto' | 'ask';
  age_days: number;
  duplicate_of: string | null;
}

export interface FactIn {
  id: string;
  text: string;
  unused_days: number | null;
}

export const ReviewResult = z.object({
  themes: z.array(z.string()),
  wins: z.array(z.string()),
  slipped: z.array(z.string()),
  suggestions: z.array(z.string()),
  tidy: z.array(
    z.object({
      id: z.string(),
      proposal: z.enum(['keep', 'archive', 'condense', 'delete']),
      reason: z.string(),
      group: z.number().int().nullable(),
    }),
  ),
  facts: z.array(
    z.object({
      action: z.enum(['merge', 'retire']),
      ids: z.array(z.string()),
      text: z.string().nullable(),
    }),
  ),
  digest: z.string(),
});
export type ReviewResultT = z.infer<typeof ReviewResult>;

export interface TidyProposal {
  kind: 'item' | 'capture';
  id: string;
  title: string;
  item_type: string | null;
  proposal: 'keep' | 'archive' | 'condense' | 'delete';
  reason: string;
  group: number | null;
}

export interface ReviewContent {
  themes: string[];
  wins: string[];
  slipped: string[];
  suggestions: string[];
  tidy: TidyProposal[];
  /** Low-risk candidates already moved to the Trash. */
  auto_done: { kind: 'item' | 'capture'; id: string; title: string; reason: string }[];
  facts: { action: 'merge' | 'retire'; ids: string[]; text: string | null }[];
  ai: { cost_eur: number; calls: number };
  stats: Record<string, unknown>;
}

export interface BuiltReview {
  status: 'ok' | 'fallback';
  content: ReviewContent;
  digest: string;
  cost_eur: number;
}

const list = (xs: string[], n: number, len = 240) =>
  xs
    .map((x) => x.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, n);

/** Keeps only proposals and fact changes about things the model was given. */
export function validate(
  r: ReviewResultT,
  ask: Candidate[],
  facts: FactIn[],
): Pick<ReviewContent, 'themes' | 'wins' | 'slipped' | 'suggestions' | 'tidy' | 'facts'> & {
  digest: string;
} {
  const byId = new Map(ask.map((c) => [c.id, c]));
  const factIds = new Set(facts.map((f) => f.id));
  const seen = new Set<string>();
  const tidy: TidyProposal[] = [];
  for (const t of r.tidy) {
    const c = byId.get(t.id);
    if (!c || seen.has(t.id)) continue;
    seen.add(t.id);
    // Condense needs notes or ideas, and a group; otherwise it becomes keep.
    const condensable =
      c.kind === 'item' && ['note', 'idea', 'meeting'].includes(c.item_type ?? '');
    const proposal =
      t.proposal === 'condense' && !(condensable && t.group !== null) ? 'keep' : t.proposal;
    tidy.push({
      kind: c.kind,
      id: c.id,
      title: c.title,
      item_type: c.item_type,
      proposal,
      reason: t.reason.trim().slice(0, 200),
      group: proposal === 'condense' ? t.group : null,
    });
  }
  // A condense group needs at least two members.
  const sizes = new Map<number, number>();
  for (const t of tidy) if (t.group !== null) sizes.set(t.group, (sizes.get(t.group) ?? 0) + 1);
  for (const t of tidy)
    if (t.group !== null && (sizes.get(t.group) ?? 0) < 2) {
      t.proposal = 'keep';
      t.group = null;
    }
  const factChanges = r.facts
    .map((f) => ({ ...f, ids: [...new Set(f.ids)].filter((id) => factIds.has(id)) }))
    .filter((f) =>
      f.action === 'merge' ? f.ids.length >= 2 && !!f.text?.trim() : f.ids.length === 1,
    )
    .map((f) => ({
      action: f.action,
      ids: f.ids,
      text: f.action === 'merge' ? (f.text ?? '').trim().slice(0, 300) : null,
    }))
    .slice(0, 10);
  return {
    themes: list(r.themes, 4, 120),
    wins: list(r.wins, 5),
    slipped: list(r.slipped, 5),
    suggestions: list(r.suggestions, 3),
    tidy,
    facts: factChanges,
    digest: r.digest.trim().slice(0, 600),
  };
}

/** The code-built review when the AI isn't available: numbers only, every candidate kept for now. */
export function fallbackDigest(week: Record<string, unknown>): string {
  const t = (week.tasks ?? {}) as Record<string, number>;
  return `Week of ${String(week.week_start)}: ${t.done ?? 0} of ${t.due ?? 0} due tasks done, ${t.added ?? 0} added, ${week.captures ?? 0} captures.`;
}

export async function buildReview(
  userId: string,
  week: Record<string, unknown>,
  pastDigests: { week_start: string; digest: string }[],
  candidates: Candidate[],
  facts: FactIn[],
  deps: { ai: AIClient; store: UsageStore },
): Promise<Omit<BuiltReview, 'content'> & { content: Omit<ReviewContent, 'auto_done'> }> {
  const ask = candidates.filter((c) => c.mode === 'ask').slice(0, 60);
  const ai = (week.ai ?? { cost_eur: 0, calls: 0 }) as { cost_eur: number; calls: number };
  const base = {
    ai: { cost_eur: Number(ai.cost_eur ?? 0), calls: Number(ai.calls ?? 0) },
    stats: week,
  };
  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'weekly_review',
      tier: 'large',
      system: REVIEW_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildReviewMessage({
            week,
            pastDigests: pastDigests.slice(0, 4),
            candidates: ask.map((c) => ({
              id: c.id,
              type: c.item_type,
              title: c.title,
              reason: c.reason,
              age_days: c.age_days,
            })),
            facts: facts.slice(0, 40),
          }),
        },
      ],
      schema: ReviewResult,
      maxTokens: 8000,
      effort: 'medium',
      background: true,
    },
  );
  if (!result.ok)
    return {
      status: 'fallback',
      digest: fallbackDigest(week),
      cost_eur: 0,
      content: { themes: [], wins: [], slipped: [], suggestions: [], tidy: [], facts: [], ...base },
    };
  const v = validate(result.data, ask, facts);
  return {
    status: 'ok',
    digest: v.digest || fallbackDigest(week),
    cost_eur: result.costEur,
    content: {
      themes: v.themes,
      wins: v.wins,
      slipped: v.slipped,
      suggestions: v.suggestions,
      tidy: v.tidy,
      facts: v.facts,
      ...base,
    },
  };
}
