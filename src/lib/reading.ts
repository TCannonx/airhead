import type { Item } from './schemas/records';

/** data.link on a reading item (Task 16.2), as the device reads it. */
export interface LinkInfo {
  status: 'read' | 'title_only' | 'unreadable';
  reason: string | null;
  source: string;
  kind: string | null;
  minutes: number | null;
  summary: string | null;
  key_points: string[];
  why_saved: string;
  topics: string[];
}

const KIND_NAMES: Record<string, string> = {
  article: 'Article',
  video: 'Video',
  paper: 'Paper',
  thread: 'Thread',
  product: 'Product',
  other: 'Link',
};

/** The enrichment of a reading item, or null when it has not been read yet. */
export function linkInfo(item: Item): LinkInfo | null {
  const l = item.data.link as Partial<LinkInfo> | undefined;
  if (!l || typeof l !== 'object' || !l.status) return null;
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    status: l.status,
    reason: typeof l.reason === 'string' ? l.reason : null,
    source: typeof l.source === 'string' ? l.source : '',
    kind: typeof l.kind === 'string' ? l.kind : null,
    minutes: typeof l.minutes === 'number' ? l.minutes : null,
    summary: typeof l.summary === 'string' ? l.summary : null,
    key_points: strs(l.key_points),
    why_saved: typeof l.why_saved === 'string' ? l.why_saved : '',
    topics: strs(l.topics),
  };
}

/** One line for a reading row: "Article · 13 min · Marathon training", or why it is unread. */
export function readingLine(item: Item): string | null {
  const l = linkInfo(item);
  if (!l) return null;
  if (l.status === 'unreadable') return `Couldn’t read: ${l.reason ?? 'unknown reason'}`;
  return [
    l.kind ? (KIND_NAMES[l.kind] ?? 'Link') : null,
    l.minutes ? `${l.minutes} min` : null,
    l.topics[0] ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}
