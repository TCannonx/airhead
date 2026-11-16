import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { buildLinkMessage, LINK_SYSTEM } from '../_shared/prompts/link.v1.ts';
import { LinkEnrichment } from '../_shared/schemas/history.ts';
import type { LinkInfo } from './extract.ts';

/** What is stored on a reading item as data.link (Task 16.2). */
export interface LinkData {
  status: 'read' | 'title_only' | 'unreadable';
  /** Plain words for an unreadable page. */
  reason: string | null;
  title: string | null;
  source: string;
  kind: string | null;
  minutes: number | null;
  summary: string | null;
  key_points: string[];
  why_saved: string;
  topics: string[];
  mentions: { kind: string; name: string }[];
  enriched_at: string;
}

/** The fetch outcome in the owner's words (Task 16.2). */
export function unreadableReason(
  fetched: { status: string; reason?: string },
  info: LinkInfo,
): string {
  if (fetched.status === 'too_large') return 'too large';
  if (fetched.status === 'blocked') return 'blocked';
  if (fetched.status === 'not_html') return 'not a web page';
  const r = (fetched.reason ?? '').toLowerCase();
  if (/http (401|403)/.test(r)) return 'needs sign-in';
  if (/http (404|410)/.test(r)) return 'not found';
  if (/timed? ?out|could not connect/.test(r)) return 'timed out';
  if (fetched.status === 'ok' && info.status === 'unreadable') return 'needs sign-in';
  return 'could not be read';
}

/**
 * Enriches one saved link: the page text in a data block, the owner's own words
 * around the link, one small call. An unreadable page keeps what is known, with
 * the reason, and makes no call. Minutes are counted in code.
 */
export async function enrichLink(
  deps: { ai: AIClient; usage: UsageStore },
  input: {
    userId: string;
    url: string;
    note: string;
    info: LinkInfo;
    fetched: { status: string; reason?: string };
    now?: Date;
  },
): Promise<LinkData> {
  const { info } = input;
  const base: LinkData = {
    status: info.status,
    reason: null,
    title: info.title,
    source: (() => {
      try {
        return new URL(input.url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })(),
    kind: null,
    minutes: info.reading_minutes,
    summary: info.description,
    key_points: [],
    why_saved: '',
    topics: [],
    mentions: [],
    enriched_at: (input.now ?? new Date()).toISOString(),
  };
  if (info.status === 'unreadable')
    return { ...base, reason: unreadableReason(input.fetched, info) };
  if (info.status === 'title_only' || !info.text) return { ...base, kind: 'video' };

  const res = await callAI(
    { client: deps.ai, store: deps.usage },
    {
      userId: input.userId,
      task: 'link_enrich',
      tier: 'small',
      system: [LINK_SYSTEM],
      messages: [
        {
          role: 'user',
          content: buildLinkMessage(
            { title: info.title, url: input.url, text: info.text },
            input.note.slice(0, 600),
          ),
        },
      ],
      schema: LinkEnrichment,
      maxTokens: 1200,
      background: true,
    },
  );
  if (!res.ok) return base;
  const d = res.data;
  const clean = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    ...base,
    kind: d.kind,
    summary: d.summary.trim().slice(0, 500) || base.summary,
    key_points: d.key_points
      .map((k) => clean(k, 160))
      .filter(Boolean)
      .slice(0, 5),
    why_saved: input.note.trim() ? clean(d.why_saved, 200) : '',
    topics: [...new Set(d.topics.map((t) => clean(t, 40)).filter(Boolean))].slice(0, 3),
    mentions: d.mentions
      .map((m) => ({ kind: m.kind, name: clean(m.name, 60) }))
      .filter((m) => m.name)
      .slice(0, 5),
  };
}
