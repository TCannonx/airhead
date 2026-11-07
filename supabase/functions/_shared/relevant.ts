import type { FactRow } from './memory.ts';

/**
 * Memory by relevance (Task 7.11): beyond the core profile, add the facts most
 * like the text at hand: by embedding similarity when facts are embedded,
 * otherwise by shared keywords. At most 8, never ones already in the profile.
 */
export const RELEVANT_LIMIT = 8;
/** gte-small vectors are normalised; related texts score about 0.8 and up. */
export const MIN_SIMILARITY = 0.8;

export interface RelevantDeps {
  embed?: (text: string) => Promise<number[]>;
  /** relevant_facts: the closest active facts above the threshold. */
  nearest?: (embedding: number[], limit: number, min: number) => Promise<FactRow[]>;
}

const STOP = new Set(
  'about after again also because been before being both could does doing done each from have having here into just like made make more most much must only other over same should some such than that their them then there these they this those through very want were what when where which while will with would your yours'.split(
    ' ',
  ),
);

export const keywords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? [])
      .map((w) => w.replace(/'s$/, ''))
      .filter((w) => !STOP.has(w)),
  );

/** Keyword fallback: facts sharing the most words with the text (at least one). */
export function keywordFacts(text: string, facts: FactRow[], limit = RELEVANT_LIMIT): FactRow[] {
  const words = keywords(text);
  return facts
    .map((f) => ({ f, n: [...keywords(f.text)].filter((w) => words.has(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.f);
}

export async function relevantFacts(
  deps: RelevantDeps,
  text: string,
  facts: FactRow[],
  inProfile: string[],
): Promise<FactRow[]> {
  const skip = new Set(inProfile);
  const rest = facts.filter((f) => !skip.has(f.id));
  if (!text.trim() || rest.length === 0) return [];
  if (deps.embed && deps.nearest) {
    try {
      const near = await deps.nearest(
        await deps.embed(text.slice(0, 4000)),
        RELEVANT_LIMIT + skip.size,
        MIN_SIMILARITY,
      );
      const picked = near.filter((f) => !skip.has(f.id)).slice(0, RELEVANT_LIMIT);
      if (picked.length) return picked;
    } catch {
      // Embeddings not ready or the model unavailable: fall back to keywords.
    }
  }
  return keywordFacts(text, rest);
}

/** The profile block with the relevant facts appended. */
export function withRelevant(profileText: string, extra: FactRow[]): string {
  if (extra.length === 0) return profileText;
  const lines = extra.map((f) => `- ${f.text.trim()}`).join('\n');
  const block = `Also likely relevant here (from their own captures):\n${lines}`;
  return profileText ? `${profileText}\n${block}` : block;
}
