/**
 * embed-items (Task 7.9): turns each queued item into ~300-word chunks of its
 * text (title, body, typed note text, summary, transcription, Workshop draft)
 * and embeds the chunks that changed with gte-small. Chunks of deleted or
 * emptied items are removed.
 */
export const CHUNK_WORDS = 300;
export const OVERLAP_WORDS = 40;
export const BATCH = 25;

export interface ItemText {
  id: string;
  user_id: string;
  title: string;
  deleted: boolean;
  /** The parts to index, in order (already plain text). */
  parts: string[];
}

export interface StoredChunk {
  chunk_index: number;
  content_hash: string;
}

export interface NewChunk {
  item_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  embedding: number[];
}

export interface EmbedDeps {
  take(limit: number): Promise<{ item_id: string; user_id: string }[]>;
  /** null when the item no longer exists. */
  load(itemId: string, userId: string): Promise<ItemText | null>;
  existing(itemId: string): Promise<StoredChunk[]>;
  upsert(chunks: NewChunk[]): Promise<void>;
  /** Removes this item's chunks with index >= fromIndex (0 = all). */
  removeFrom(itemId: string, fromIndex: number): Promise<void>;
  embed(text: string): Promise<number[]>;
  /** Memory facts waiting for an embedding (Task 7.11). */
  factsToEmbed?(limit: number): Promise<{ id: string; text: string }[]>;
  storeFact?(id: string, embedding: number[]): Promise<void>;
}

export const FACT_BATCH = 50;

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Splits text into overlapping chunks of about CHUNK_WORDS words, each led by the title. */
export function chunkText(title: string, parts: string[]): string[] {
  const words = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n')
    .split(/\s+/)
    .filter(Boolean);
  const head = title.trim();
  if (words.length === 0) return head ? [head] : [];
  const out: string[] = [];
  for (let start = 0; start < words.length; start += CHUNK_WORDS - OVERLAP_WORDS) {
    const body = words.slice(start, start + CHUNK_WORDS).join(' ');
    out.push(head ? `${head}\n${body}` : body);
    if (start + CHUNK_WORDS >= words.length) break;
  }
  return out;
}

export async function runEmbed(
  deps: EmbedDeps,
): Promise<{ items: number; embedded: number; skipped: number; removed: number; facts: number }> {
  const queued = await deps.take(BATCH);
  const stats = { items: queued.length, embedded: 0, skipped: 0, removed: 0, facts: 0 };
  for (const q of queued) {
    const item = await deps.load(q.item_id, q.user_id);
    if (!item || item.deleted) {
      await deps.removeFrom(q.item_id, 0);
      stats.removed++;
      continue;
    }
    const texts = chunkText(item.title, item.parts);
    const known = new Map(
      (await deps.existing(item.id)).map((c) => [c.chunk_index, c.content_hash]),
    );
    const fresh: NewChunk[] = [];
    for (const [i, content] of texts.entries()) {
      const hash = await sha256Hex(content);
      if (known.get(i) === hash) {
        stats.skipped++;
        continue;
      }
      fresh.push({
        item_id: item.id,
        user_id: item.user_id,
        chunk_index: i,
        content,
        content_hash: hash,
        embedding: await deps.embed(content),
      });
    }
    if (fresh.length) await deps.upsert(fresh);
    stats.embedded += fresh.length;
    if ([...known.keys()].some((k) => k >= texts.length)) {
      await deps.removeFrom(item.id, texts.length);
      stats.removed++;
    }
  }
  if (deps.factsToEmbed && deps.storeFact) {
    for (const f of await deps.factsToEmbed(FACT_BATCH)) {
      await deps.storeFact(f.id, await deps.embed(f.text));
      stats.facts++;
    }
  }
  return stats;
}
