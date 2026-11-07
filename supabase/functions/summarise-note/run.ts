import type Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { parseHTML } from 'npm:linkedom@0.18.15';
import { z } from 'npm:zod@4.6.7';
import { callAI, type AIClient, type UsageStore } from '../_shared/ai.ts';
import { buildSummariseMessage, SUMMARISE_SYSTEM } from '../_shared/prompts/summarise.v1.ts';

export const SummaryResult = z.object({
  transcription: z.string().nullable(),
  summary: z.string(),
  decisions: z.array(z.string()),
  actions: z.array(
    z.object({ title: z.string(), owner: z.string().nullable(), due_text: z.string().nullable() }),
  ),
});
export type SummaryResultT = z.infer<typeof SummaryResult>;

export interface SummariseRequest {
  kind?: 'typed' | 'ink';
  title?: string;
  date?: string | null;
  attendees?: string[];
  /** typed: the note's HTML */
  html?: string;
  /** ink: PNG pages as base64 (rendered on the device) */
  images?: string[];
}

export const MAX_TEXT = 60_000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type SummariseOutcome =
  | { ok: true; error_code: null; message: string; result: SummaryResultT; cost_eur: number }
  | { ok: false; error_code: string; message: string };

/** Visible text of a typed note: block per line, list items as "- …", checkboxes as "[ ]"/"[x]". */
export function noteText(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`) as unknown as {
    document: {
      body: { textContent: string | null } | null;
      querySelectorAll(s: string): Iterable<{
        prepend(t: unknown): void;
        append(t: unknown): void;
        getAttribute(n: string): string | null;
      }>;
      createTextNode(t: string): unknown;
    };
  };
  for (const li of document.querySelectorAll('li')) {
    const checked = li.getAttribute('data-checked');
    li.prepend(
      document.createTextNode(checked === 'true' ? '[x] ' : checked === 'false' ? '[ ] ' : '- '),
    );
  }
  for (const el of document.querySelectorAll('p,h1,h2,h3,li,div,br'))
    el.append(document.createTextNode('\n'));
  return (document.body?.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_TEXT);
}

export function checkRequest(r: SummariseRequest): string | null {
  if (r.kind !== 'typed' && r.kind !== 'ink') return 'Unknown kind of note.';
  if (r.kind === 'typed' && !(r.html ?? '').trim()) return 'The note is empty.';
  if (r.kind === 'ink' && !(r.images?.length ?? 0)) return 'The page is empty.';
  if ((r.images?.length ?? 0) > MAX_IMAGES) return 'Too many pages to summarise at once.';
  if ((r.images ?? []).some((i) => i.length * 0.75 > MAX_IMAGE_BYTES))
    return 'A page image is too big.';
  return null;
}

/** Keeps the result tidy: trimmed, capped, no empty entries. */
export function clean(r: SummaryResultT, kind: 'typed' | 'ink'): SummaryResultT {
  const s = (x: string | null, n: number) => (x && x.trim() ? x.trim().slice(0, n) : null);
  return {
    transcription: kind === 'ink' ? s(r.transcription, MAX_TEXT) : null,
    summary: r.summary.trim().slice(0, 1200),
    decisions: r.decisions
      .map((d) => d.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 20),
    actions: r.actions
      .map((a) => ({
        title: a.title.trim().slice(0, 200),
        owner: s(a.owner, 80),
        due_text: s(a.due_text, 80),
      }))
      .filter((a) => a.title)
      .slice(0, 30),
  };
}

/** One large-tier call: text for typed notes, images (vision) for handwritten pages. */
export async function runSummarise(
  req: SummariseRequest,
  userId: string,
  deps: { ai: AIClient; store: UsageStore },
): Promise<SummariseOutcome> {
  const problem = checkRequest(req);
  if (problem) return { ok: false, error_code: 'bad_request', message: problem };
  const kind = req.kind as 'typed' | 'ink';
  const head = buildSummariseMessage({
    title: (req.title ?? 'Note').slice(0, 200),
    date: req.date ?? null,
    attendees: (req.attendees ?? []).slice(0, 30),
    text: kind === 'typed' ? noteText(req.html ?? '') : undefined,
  });
  const content: Anthropic.ContentBlockParam[] =
    kind === 'ink'
      ? [
          ...(req.images ?? []).map(
            (data) =>
              ({
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data },
              }) as const,
          ),
          { type: 'text', text: head },
        ]
      : [{ type: 'text', text: head }];
  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'summarise_note',
      tier: 'large',
      system: SUMMARISE_SYSTEM,
      messages: [{ role: 'user', content }],
      schema: SummaryResult,
      maxTokens: 8000,
      effort: 'low',
      background: false,
    },
  );
  if (!result.ok) return { ok: false, error_code: result.error_code, message: result.message };
  return {
    ok: true,
    error_code: null,
    message: 'Summarised.',
    result: clean(result.data, kind),
    cost_eur: result.costEur,
  };
}
