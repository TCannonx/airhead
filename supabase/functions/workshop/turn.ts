import { z } from 'npm:zod@4.6.7';
import { callAI } from '../_shared/ai.ts';
import { buildProfile } from '../_shared/memory.ts';
import { withRelevant } from '../_shared/relevant.ts';
import { buildTurnMessage, TURN_SYSTEM } from '../_shared/prompts/workshop-turn.v1.ts';
import {
  cleanDraft,
  DraftContent,
  draftText,
  type WorkshopDeps,
  type WorkshopOutcome,
} from './run.ts';

/** Only the most recent turns go to the model, with the current draft (Task 7.7). */
export const RECENT_TURNS = 6;
export const MAX_ANSWER = 4000;

export const TurnResult = z.object({
  questions: z.array(z.string()),
  draft: DraftContent,
});

export interface Turn {
  role: 'airhead' | 'me';
  text: string;
  at: string;
}

export interface TurnDeps extends WorkshopDeps {
  loadTurns(itemId: string): Promise<Turn[]>;
  /** Writes the session (id = item id) with these turns and no pending answer. */
  saveTurns(itemId: string, turns: Turn[]): Promise<Record<string, unknown>>;
  now?: () => Date;
}

export type TurnOutcome =
  | (Extract<WorkshopOutcome, { ok: true }> & { session: Record<string, unknown> })
  | Extract<WorkshopOutcome, { ok: false }>;

/**
 * One turn of "Work on it together": the current draft, the last few turns and
 * the new answer (none at the start) go in; two or three questions and an
 * updated draft (a new version) come out. The session's turns are written
 * here, by the server only.
 */
export async function runTurn(
  itemId: string,
  answer: string | null,
  userId: string,
  deps: TurnDeps,
): Promise<TurnOutcome> {
  const text = answer?.trim().slice(0, MAX_ANSWER) || null;
  const src = await deps.load(itemId);
  if (!src)
    return { ok: false, error_code: 'not_found', message: 'That idea isn’t here any more.' };
  const turns = await deps.loadTurns(itemId);
  const recent = turns.slice(-RECENT_TURNS);
  const profile = buildProfile(src.facts);
  const extra = (src.relevant ?? []).filter((f) => !profile.ids.includes(f.id));
  const memory = withRelevant(profile.text, extra);
  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'workshop_turn',
      tier: 'large',
      system: memory ? [TURN_SYSTEM, memory] : TURN_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildTurnMessage({
            title: src.item.title.slice(0, 300),
            body: src.item.body?.slice(0, 6000) ?? null,
            draft: src.current ? draftText(src.current).slice(0, 8000) : null,
            turns: recent.map((t) => ({ role: t.role, text: t.text.slice(0, 2000) })),
            answer: text,
          }),
        },
      ],
      schema: TurnResult,
      maxTokens: 8000,
      effort: 'medium',
      background: false,
    },
  );
  if (!result.ok) return { ok: false, error_code: result.error_code, message: result.message };
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const questions = result.data.questions
    .map((q) => q.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 3);
  const draft = await deps.saveDraft(itemId, cleanDraft(result.data.draft), 'session');
  const session = await deps.saveTurns(itemId, [
    ...turns,
    ...(text ? [{ role: 'me' as const, text, at }] : []),
    ...(questions.length ? [{ role: 'airhead' as const, text: questions.join('\n'), at }] : []),
  ]);
  const used = [...profile.ids, ...extra.map((f) => f.id)];
  if (used.length) await deps.markFactsUsed?.(used);
  return { ok: true, error_code: null, message: 'Updated.', draft, session };
}
