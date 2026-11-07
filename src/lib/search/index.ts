import MiniSearch from 'minisearch';
import type { Capture, Item, ItemType } from '../schemas/records';

export interface SearchResult {
  kind: 'item' | 'capture';
  id: string;
  title: string;
  itemType: ItemType | null;
  score: number;
}

interface Doc {
  key: string;
  kind: 'item' | 'capture';
  id: string;
  title: string;
  body: string;
  itemType: ItemType | null;
}

const firstLine = (s: string) => s.split('\n')[0]?.trim() ?? '';

/**
 * On-device full-text search over item titles and bodies and capture text
 * (MiniSearch). Kept in memory and updated incrementally: only rows whose
 * updated_at changed are re-indexed; deleted or dropped rows are removed.
 */
export class SearchIndex {
  private mini = new MiniSearch<Doc>({
    idField: 'key',
    fields: ['title', 'body'],
    storeFields: ['kind', 'id', 'title', 'itemType'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 }, combineWith: 'AND' },
  });
  private versions = new Map<string, string>();

  get size(): number {
    return this.mini.documentCount;
  }

  sync(items: Item[], captures: Capture[]): { added: number; updated: number; removed: number } {
    const next = new Map<string, { version: string; doc: Doc }>();
    for (const i of items) {
      if (i.deleted_at || i.status === 'dropped') continue;
      next.set(`i:${i.id}`, {
        version: i.updated_at,
        doc: {
          key: `i:${i.id}`,
          kind: 'item',
          id: i.id,
          title: i.title,
          body: i.body ?? '',
          itemType: i.type,
        },
      });
    }
    for (const c of captures) {
      const text = c.text ?? c.url ?? '';
      if (c.deleted_at || !text) continue;
      next.set(`c:${c.id}`, {
        version: c.updated_at,
        doc: {
          key: `c:${c.id}`,
          kind: 'capture',
          id: c.id,
          title: firstLine(text),
          body: text,
          itemType: null,
        },
      });
    }

    const counts = { added: 0, updated: 0, removed: 0 };
    for (const key of [...this.versions.keys()]) {
      if (!next.has(key)) {
        this.mini.discard(key);
        this.versions.delete(key);
        counts.removed++;
      }
    }
    for (const [key, { version, doc }] of next) {
      const known = this.versions.get(key);
      if (known === version) continue;
      if (known === undefined) {
        this.mini.add(doc);
        counts.added++;
      } else {
        this.mini.replace(doc);
        counts.updated++;
      }
      this.versions.set(key, version);
    }
    return counts;
  }

  search(query: string, limit = 50): SearchResult[] {
    if (!query.trim()) return [];
    return this.mini
      .search(query)
      .slice(0, limit)
      .map((r) => ({
        kind: r.kind as SearchResult['kind'],
        id: r.id as string,
        title: r.title as string,
        itemType: (r.itemType as ItemType | null) ?? null,
        score: r.score,
      }));
  }
}
