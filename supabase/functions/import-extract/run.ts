import type Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { parseHTML } from 'npm:linkedom@0.18.15';
import { callAI, type AIClient, type UsageStore } from '../_shared/ai.ts';
import { buildImportMessage, IMPORT_SYSTEM } from '../_shared/prompts/import.v1.ts';
import { safeFetch, type SafeFetchDeps, type SafeFetchOptions } from '../read-link/safeFetch.ts';
import {
  checkRequest,
  cleanEvents,
  ImportResult,
  MAX_TEXT,
  type ExtractedEvent,
  type ExtractRequest,
} from './extract.ts';

export type ImportOutcome =
  | { ok: true; error_code: null; message: string; kind: 'events'; events: ExtractedEvent[] }
  | { ok: true; error_code: null; message: string; kind: 'ics'; text: string }
  | { ok: false; error_code: string; message: string };

/** A fixtures page may be HTML or an .ics file; both are fetched the safe way. */
const PAGE_OPTIONS: SafeFetchOptions = {
  accept: 'text/html,text/calendar;q=0.9,text/plain;q=0.8',
  allowType:
    /text\/html|application\/xhtml\+xml|text\/calendar|text\/plain|application\/(?:octet-stream|ics)/i,
  maxBytes: 3 * 1024 * 1024,
  userAgent: 'Airhead schedule import',
};

const BLOCKS = 'p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,table,br,dt,dd';

/** The slice of the DOM used here (Deno has no DOM types; linkedom provides the DOM). */
interface Node_ {
  remove(): void;
  append(node: unknown): void;
}
interface Doc {
  querySelectorAll(selector: string): Iterable<Node_>;
  createTextNode(text: string): unknown;
  body: { textContent: string | null } | null;
  textContent: string | null;
}

/** The visible text of a page, one block per line (tables keep their rows). */
export function pageText(html: string): string {
  const document = (parseHTML(html) as unknown as { document: Doc }).document;
  for (const el of document.querySelectorAll(
    'script,style,noscript,svg,nav,header,footer,form,iframe',
  ))
    el.remove();
  for (const el of document.querySelectorAll('td,th')) el.append(document.createTextNode(' | '));
  for (const el of document.querySelectorAll(BLOCKS)) el.append(document.createTextNode('\n'));
  const text = (document.body?.textContent ?? document.textContent ?? '')
    .split('\n')
    .map((l: string) =>
      l
        .replace(/[\s|]+$/g, '')
        .replace(/[ \t\u00a0]+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
  return text.slice(0, MAX_TEXT);
}

export interface ImportDeps {
  ai: AIClient;
  store: UsageStore;
  fetch: SafeFetchDeps;
}

/**
 * One import, at most one AI call (Task 4.10). Free routes come first: a link
 * that serves iCalendar comes back as text for the device to parse exactly.
 */
export async function runImport(
  body: ExtractRequest,
  userId: string,
  deps: ImportDeps,
): Promise<ImportOutcome> {
  const problem = checkRequest(body);
  if (problem) return { ok: false, error_code: 'bad_request', message: problem };

  let text = body.text;
  if (body.kind === 'link') {
    const fetched = await safeFetch(
      (body.url ?? '').trim().replace(/^webcals?:\/\//i, 'https://'),
      deps.fetch,
      PAGE_OPTIONS,
    );
    if (fetched.status !== 'ok') {
      return {
        ok: false,
        error_code: 'unreadable',
        message:
          fetched.status === 'blocked'
            ? 'That address isn’t allowed.'
            : `Couldn’t read that page (${fetched.reason}).`,
      };
    }
    if (/^\s*BEGIN:VCALENDAR/i.test(fetched.html.replace(/^\uFEFF/, ''))) {
      return {
        ok: true,
        error_code: null,
        message: 'Calendar file found.',
        kind: 'ics',
        text: fetched.html,
      };
    }
    text = pageText(fetched.html);
    if (text.split(/\s+/).length < 10) {
      return { ok: false, error_code: 'unreadable', message: 'That page had no schedule to read.' };
    }
  }

  const head = buildImportMessage({
    instruction: body.instruction ?? '',
    today: body.today ?? new Date().toISOString().slice(0, 10),
    timeZone: body.time_zone ?? 'Europe/Dublin',
    text: body.kind === 'text' || body.kind === 'link' ? text : undefined,
  });
  const content: Anthropic.ContentBlockParam[] =
    body.kind === 'image'
      ? [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: body.media_type as 'image/png',
              data: body.data ?? '',
            },
          },
          { type: 'text', text: head },
        ]
      : body.kind === 'pdf'
        ? [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: body.data ?? '' },
            },
            { type: 'text', text: head },
          ]
        : [{ type: 'text', text: head }];

  const result = await callAI(
    { client: deps.ai, store: deps.store },
    {
      userId,
      task: 'import_extract',
      tier: 'small',
      system: IMPORT_SYSTEM,
      messages: [{ role: 'user', content }],
      schema: ImportResult,
      maxTokens: 16000,
      effort: 'low',
      background: false,
    },
  );
  if (!result.ok) return { ok: false, error_code: result.error_code, message: result.message };
  const events = cleanEvents(result.data);
  return {
    ok: true,
    error_code: null,
    kind: 'events',
    events,
    message: events.length
      ? `Found ${events.length} event${events.length === 1 ? '' : 's'}.`
      : (result.data.skipped_note ?? 'No events found.'),
  };
}
