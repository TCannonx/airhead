import type { AIClient, UsageStore } from '../_shared/ai.ts';
import linkFx from '../../../tests/fixtures/ai/link-enrich.json' with { type: 'json' };
import topicFx from '../../../tests/fixtures/ai/topic-collate.json' with { type: 'json' };
import { findUrlsServer } from './readingText.ts';
import { runPageSummaries, type PageRow } from '../page-summary/run.ts';
import { enrichLink } from '../read-link/enrich.ts';
import type { CaseReport } from './run.ts';

const USER = '00000000-0000-4000-8000-0000000000e1';
const blank = { actions: [], updates: [], workshop: 0, follow_ups: [] };

/**
 * Reading cases (Task 16.8, spec section 8 cases 4 to 6) for the real model:
 * a link inside a sentence is explained; a fifth link updates its topic page and
 * every link has its note; an unreadable link says why (no AI call).
 */
export async function runReadingEval(
  ai: AIClient,
  store: UsageStore,
): Promise<{ ok: boolean; error: string | null; cost_eur: number; cases: CaseReport[] }> {
  let cost = 0;
  const counting: UsageStore = {
    ...store,
    record: async (r) => {
      cost += r.cost_eur;
      await store.record(r);
    },
  };
  const cases: CaseReport[] = [];

  // 4. A note with a link inside a sentence.
  const note = `${linkFx.note}: ${linkFx.url} worth a read before Sunday`;
  const [url] = findUrlsServer(note);
  const link = await enrichLink(
    { ai, usage: counting },
    {
      userId: USER,
      url: url ?? '',
      note: note.replace(url ?? '', ' '),
      info: {
        status: 'read',
        title: linkFx.page.title,
        description: null,
        word_count: 60,
        reading_minutes: 1,
        text: linkFx.page.text,
      },
      fetched: { status: 'ok' },
    },
  );
  const p4 = [
    ...(url === linkFx.url ? [] : ['the link inside the sentence was not found']),
    ...(link.kind ? [] : ['no type']),
    ...((link.summary ?? '').split('\n').filter(Boolean).length >= 2
      ? []
      : ['no three-line summary']),
    ...(link.topics.length ? [] : ['no topics']),
    ...(/marathon/i.test(link.why_saved) ? [] : ['why it was saved does not use the note']),
  ];
  cases.push({
    id: 'reading-link-in-sentence',
    kind: 'reading',
    text: note,
    meant: 'A reading item with a summary, its type and topics, and why it was saved.',
    pass: p4.length === 0,
    problems: p4,
    got: { items: [link], ...blank },
  });

  // 5. The fifth link on a topic.
  let saved: { summary: string; notes: { item_id: string; note: string }[] } | null = null;
  const res = await runPageSummaries(USER, {
    store: {
      due: async () => [
        { ...(topicFx.page as PageRow), summary: 'Three pieces on getting ready.' },
      ],
      items: async () => topicFx.links,
      save: async () => {},
      readingCount: async () => 5,
      saveTopic: async (_p, row) => {
        saved = row;
      },
    },
    ai,
    usage: counting,
  });
  const s = saved as { summary: string; notes: { item_id: string; note: string }[] } | null;
  const p5 = [
    ...(res.failed.length ? ['the topic call failed'] : []),
    ...(s && s.notes.length === topicFx.links.length ? [] : ['not every link has its note']),
    ...(s && /fuel|food/i.test(s.summary) ? [] : ['the summary does not take in the fifth link']),
  ];
  cases.push({
    id: 'reading-fifth-link',
    kind: 'reading',
    text: 'A fifth link saved on Marathon training',
    meant: 'The topic page is updated and lists all five links with their context.',
    pass: p5.length === 0,
    problems: p5,
    got: { items: s ? [s] : [], ...blank },
  });

  // 6. An unreadable link (no AI call).
  const shut = await enrichLink(
    { ai, usage: counting },
    {
      userId: USER,
      url: 'https://members.example/article',
      note: '',
      info: {
        status: 'unreadable',
        title: null,
        description: null,
        word_count: 0,
        reading_minutes: null,
        text: null,
      },
      fetched: { status: 'error', reason: 'HTTP 403' },
    },
  );
  const p6 =
    shut.status === 'unreadable' && shut.reason === 'needs sign-in' ? [] : ['no plain reason'];
  cases.push({
    id: 'reading-unreadable',
    kind: 'reading',
    text: 'https://members.example/article',
    meant: 'Shown as unread with the reason in plain words.',
    pass: p6.length === 0,
    problems: p6,
    got: { items: [shut], ...blank },
  });

  return { ok: true, error: null, cost_eur: cost, cases };
}
