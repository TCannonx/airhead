import { z } from 'npm:zod@4.6.7';
import { callAI, type AIClient, type Tier, type UsageStore } from '../_shared/ai.ts';
import { ASK_SYSTEM, buildAskMessage } from '../_shared/prompts/ask.v1.ts';

export const TOP_PASSAGES = 8;
export const MAX_QUESTION = 1000;

export const AskResult = z.object({
  answer: z.string(),
  citations: z.array(z.number().int()),
});

export interface Passage {
  item_id: string;
  content: string;
}

export interface AskDeps {
  ai: AIClient;
  store: UsageStore;
  embed(text: string): Promise<number[]>;
  /** hybrid_search as the signed-in user (own rows only). */
  search(question: string, embedding: number[], count: number): Promise<Passage[]>;
  /** Titles and types of these items (own, not deleted). */
  items(ids: string[]): Promise<Map<string, { title: string; type: string }>>;
  tier(): Promise<Tier>;
}

export interface Source {
  n: number;
  item_id: string;
  title: string;
  type: string;
}

export type AskOutcome =
  | { ok: true; error_code: null; message: string; answer: string; sources: Source[] }
  | { ok: false; error_code: string; message: string };

/**
 * Ask Airhead: hybrid search finds the top passages, one AI call answers from
 * them, and only citations of passages it was given are kept.
 */
export async function runAsk(question: string, userId: string, deps: AskDeps): Promise<AskOutcome> {
  const q = question.trim().slice(0, MAX_QUESTION);
  if (!q) return { ok: false, error_code: 'bad_request', message: 'Ask a question first.' };
  const hits = await deps.search(q, await deps.embed(q), TOP_PASSAGES);
  const items = await deps.items([...new Set(hits.map((h) => h.item_id))]);
  const passages = hits
    .filter((h) => items.has(h.item_id))
    .slice(0, TOP_PASSAGES)
    .map((h, i) => ({
      n: i + 1,
      item_id: h.item_id,
      title: items.get(h.item_id)?.title ?? '',
      content: h.content,
    }));
  if (passages.length === 0)
    return {
      ok: true,
      error_code: null,
      message: 'Nothing found.',
      answer: 'Nothing in Airhead matches that yet.',
      sources: [],
    };

  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'ask',
      tier: await deps.tier(),
      system: ASK_SYSTEM,
      messages: [{ role: 'user', content: buildAskMessage(q, passages) }],
      schema: AskResult,
      maxTokens: 2000,
      effort: 'low',
      background: false,
    },
  );
  if (!result.ok) return { ok: false, error_code: result.error_code, message: result.message };

  const byN = new Map(passages.map((p) => [p.n, p]));
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const n of result.data.citations) {
    const p = byN.get(n);
    if (!p || seen.has(p.item_id)) continue;
    seen.add(p.item_id);
    sources.push({
      n,
      item_id: p.item_id,
      title: p.title,
      type: items.get(p.item_id)?.type ?? 'note',
    });
  }
  return {
    ok: true,
    error_code: null,
    message: 'Answered.',
    answer: result.data.answer.trim().slice(0, 4000),
    sources,
  };
}
