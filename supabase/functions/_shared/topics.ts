/**
 * Topic matching (Task 16.4): a link's topic names against the person's topics.
 * Exact and normalised names first, then the closest existing topic by meaning
 * (cosine similarity of gte-small embeddings, at or above SIMILAR), else a new
 * topic. Pure: the embedding function is passed in.
 */
export interface TopicRow {
  id: string;
  name: string;
}

export interface TopicMatch {
  name: string;
  /** The existing topic, or null when a new one is needed. */
  id: string | null;
  how: 'exact' | 'normalised' | 'similar' | 'new';
}

/** Cosine similarity at or above which two topic names are the same topic. */
export const SIMILAR = 0.86;

/** "Marathon-Training " → "marathon training"; a plural "runs" → "run". */
export function normTopic(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function matchTopics(
  names: string[],
  existing: TopicRow[],
  embed?: (text: string) => Promise<number[] | null>,
): Promise<TopicMatch[]> {
  const out: TopicMatch[] = [];
  const byExact = new Map(existing.map((t) => [t.name.trim(), t.id]));
  const byNorm = new Map(existing.map((t) => [normTopic(t.name), t.id]));
  let vectors: { id: string; v: number[] }[] | null = null;
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name || out.some((m) => normTopic(m.name) === normTopic(name))) continue;
    const exact = byExact.get(name);
    if (exact) {
      out.push({ name, id: exact, how: 'exact' });
      continue;
    }
    const norm = byNorm.get(normTopic(name));
    if (norm) {
      out.push({ name, id: norm, how: 'normalised' });
      continue;
    }
    if (embed && existing.length) {
      vectors ??= (
        await Promise.all(
          existing
            .slice(0, 200)
            .map(async (t) => ({ id: t.id, v: (await embed(t.name).catch(() => null)) ?? [] })),
        )
      ).filter((x) => x.v.length);
      const v = await embed(name).catch(() => null);
      if (v) {
        let best: { id: string; s: number } | null = null;
        for (const t of vectors) {
          const s = cosine(v, t.v);
          if (!best || s > best.s) best = { id: t.id, s };
        }
        if (best && best.s >= SIMILAR) {
          out.push({ name, id: best.id, how: 'similar' });
          continue;
        }
      }
    }
    out.push({ name, id: null, how: 'new' });
  }
  return out;
}
