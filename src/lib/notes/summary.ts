import type { NoteSummary } from '../auth/types';
import type { Item, NoteDoc } from '../schemas/records';

export type StoredSummary = NoteSummary & { at: string };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** The summary stored on a note item (`data.summary`), or null; tolerant of bad data. */
export function readSummary(item: Pick<Item, 'data'>): StoredSummary | null {
  const s = item.data.summary;
  if (!s || typeof s !== 'object') return null;
  const r = s as Record<string, unknown>;
  if (typeof r.summary !== 'string') return null;
  const actions = Array.isArray(r.actions) ? r.actions : [];
  return {
    transcription: str(r.transcription),
    summary: r.summary,
    decisions: strings(r.decisions),
    actions: actions
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .filter((a) => typeof a.title === 'string' && a.title)
      .map((a) => ({ title: a.title as string, owner: str(a.owner), due_text: str(a.due_text) })),
    at: typeof r.at === 'string' ? r.at : '',
  };
}

/** Words a summarised note adds to search: summary, decisions, actions, transcription. */
export function summaryText(item: Pick<Item, 'data'>): string {
  const s = readSummary(item);
  if (!s) return '';
  return [s.summary, ...s.decisions, ...s.actions.map((a) => a.title), s.transcription ?? '']
    .filter(Boolean)
    .join('\n');
}

/** Rough cost of one Summarise at the default Sonnet prices (a typed note or a page or two). */
export const SUMMARISE_COST_TEXT = '≈ €0.02';

/** Visible text of a typed note's HTML (for search); blocks become lines. */
export function htmlText(html: string): string {
  if (!html) return '';
  const spaced = html.replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div)[^>]*>/gi, '$&\n');
  if (typeof DOMParser !== 'undefined')
    return new DOMParser().parseFromString(spaced, 'text/html').body.textContent?.trim() ?? '';
  return spaced.replace(/<[^>]*>/g, ' ').trim();
}

/** Typed text or ink text boxes of a note document, for search. */
export function docText(doc: Pick<NoteDoc, 'kind' | 'doc'>): string {
  if (doc.kind === 'typed') return htmlText(typeof doc.doc.html === 'string' ? doc.doc.html : '');
  const pages = Array.isArray(doc.doc.pages)
    ? (doc.doc.pages as { texts?: { text?: unknown }[] }[])
    : [];
  return pages
    .flatMap((p) => (Array.isArray(p.texts) ? p.texts : []))
    .map((t) => (typeof t.text === 'string' ? t.text : ''))
    .filter(Boolean)
    .join('\n');
}
