import type { Proposal } from '../db/tidy';
import type { Review } from '../schemas/records';

/** A weekly review as the app shows it (Task 8.4); tolerant of missing parts. */
export interface ReviewView {
  week_start: string;
  status: 'ok' | 'fallback';
  themes: string[];
  wins: string[];
  slipped: string[];
  suggestions: string[];
  tidy: Proposal[];
  auto_done: { kind: 'item' | 'capture'; id: string; title: string; reason: string }[];
  facts: { action: 'merge' | 'retire'; ids: string[]; text: string | null }[];
  ai: { cost_eur: number; calls: number };
}

const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const objs = (v: unknown) =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    : [];

export function readReview(r: Review): ReviewView {
  const c = r.content;
  const ai = (c.ai ?? {}) as Record<string, unknown>;
  return {
    week_start: r.week_start,
    status: r.status,
    themes: strs(c.themes),
    wins: strs(c.wins),
    slipped: strs(c.slipped),
    suggestions: strs(c.suggestions),
    tidy: objs(c.tidy)
      .filter((t) => typeof t.id === 'string' && (t.kind === 'item' || t.kind === 'capture'))
      .map((t) => ({
        kind: t.kind as 'item' | 'capture',
        id: t.id as string,
        title: typeof t.title === 'string' ? t.title : '',
        item_type: typeof t.item_type === 'string' ? t.item_type : null,
        proposal: (['keep', 'archive', 'condense', 'delete'] as const).includes(t.proposal as never)
          ? (t.proposal as Proposal['proposal'])
          : 'keep',
        reason: typeof t.reason === 'string' ? t.reason : '',
        group: typeof t.group === 'number' ? t.group : null,
      })),
    auto_done: objs(c.auto_done).map((a) => ({
      kind: a.kind === 'capture' ? 'capture' : 'item',
      id: String(a.id ?? ''),
      title: String(a.title ?? ''),
      reason: String(a.reason ?? ''),
    })),
    facts: objs(c.facts)
      .filter((f) => f.action === 'merge' || f.action === 'retire')
      .map((f) => ({
        action: f.action as 'merge' | 'retire',
        ids: strs(f.ids),
        text: typeof f.text === 'string' ? f.text : null,
      })),
    ai: { cost_eur: Number(ai.cost_eur ?? 0), calls: Number(ai.calls ?? 0) },
  };
}
