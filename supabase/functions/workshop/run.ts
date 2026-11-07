import { z } from 'npm:zod@4.6.7';
import { callAI, type AIClient, type UsageStore } from '../_shared/ai.ts';
import { buildProfile, type FactRow } from '../_shared/memory.ts';
import { buildFleshOutMessage, FLESHOUT_SYSTEM } from '../_shared/prompts/fleshout.v1.ts';

export const DraftContent = z.object({
  summary: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  open_questions: z.array(z.string()),
  next_steps: z.array(z.string()),
});
export type DraftContentT = z.infer<typeof DraftContent>;

export const MAX_PAGE = 12_000;
export const MAX_NOTES = 6_000;

export interface WorkshopSource {
  item: { id: string; title: string; body: string | null; data: Record<string, unknown> };
  /** The original capture's text, if any. */
  captureText: string | null;
  /** Article text of a linked page, if it was read. */
  pageText: string | null;
  facts: FactRow[];
  /** The newest draft, if there is one. */
  current: DraftContentT | null;
}

export interface WorkshopDeps {
  ai: AIClient;
  store: UsageStore;
  /** null when the item doesn't exist or isn't this user's. */
  load(itemId: string): Promise<WorkshopSource | null>;
  /** Inserts a new version (the database numbers it) and returns the row. */
  saveDraft(
    itemId: string,
    content: DraftContentT,
    source: 'auto' | 'session',
  ): Promise<Record<string, unknown>>;
  markFactsUsed?(ids: string[]): Promise<void>;
}

export type WorkshopOutcome =
  | { ok: true; error_code: null; message: string; draft: Record<string, unknown> }
  | { ok: false; error_code: string; message: string };

const trimList = (xs: string[], n: number, len: number) =>
  xs
    .map((x) => x.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, n);

export function cleanDraft(d: DraftContentT): DraftContentT {
  return {
    summary: d.summary.trim().slice(0, 1500),
    sections: d.sections
      .map((s) => ({ heading: s.heading.trim().slice(0, 120), body: s.body.trim().slice(0, 3000) }))
      .filter((s) => s.heading || s.body)
      .slice(0, 10),
    open_questions: trimList(d.open_questions, 10, 300),
    next_steps: trimList(d.next_steps, 12, 200),
  };
}

export const draftText = (d: DraftContentT) =>
  [
    d.summary,
    ...d.sections.map((s) => `## ${s.heading}\n${s.body}`),
    d.open_questions.length ? `Open questions:\n- ${d.open_questions.join('\n- ')}` : '',
    d.next_steps.length ? `Next steps:\n- ${d.next_steps.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

/** Auto flesh-out: one large-tier call; the result is saved as a new version. */
export async function runFleshOut(
  itemId: string,
  userId: string,
  deps: WorkshopDeps,
): Promise<WorkshopOutcome> {
  const src = await deps.load(itemId);
  if (!src)
    return { ok: false, error_code: 'not_found', message: 'That idea isn’t here any more.' };
  const profile = buildProfile(src.facts);
  const summary = typeof src.item.data.summary === 'string' ? src.item.data.summary : null;
  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'workshop_flesh_out',
      tier: 'large',
      system: profile.text ? [FLESHOUT_SYSTEM, profile.text] : FLESHOUT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildFleshOutMessage({
            title: src.item.title.slice(0, 300),
            body: src.item.body?.slice(0, MAX_NOTES) ?? null,
            notes:
              [src.captureText, summary]
                .filter((x): x is string => !!x && x !== src.item.title)
                .join('\n')
                .slice(0, MAX_NOTES) || null,
            page: src.pageText?.slice(0, MAX_PAGE) ?? null,
            current: src.current ? draftText(src.current).slice(0, MAX_NOTES) : null,
          }),
        },
      ],
      schema: DraftContent,
      maxTokens: 8000,
      effort: 'medium',
      background: false,
    },
  );
  if (!result.ok) return { ok: false, error_code: result.error_code, message: result.message };
  const draft = await deps.saveDraft(itemId, cleanDraft(result.data), 'auto');
  if (profile.ids.length) await deps.markFactsUsed?.(profile.ids);
  return { ok: true, error_code: null, message: 'Draft ready.', draft };
}
