import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { buildPageMessage, PAGE_SYSTEM } from '../_shared/prompts/page.v1.ts';
import { buildTopicMessage, TOPIC_SYSTEM } from '../_shared/prompts/topic.v1.ts';
import { PageSummaryResult, TopicResult } from '../_shared/schemas/history.ts';
import { clampWords } from '../day-digest/run.ts';

export interface PageRow {
  id: string;
  kind: string;
  name: string;
  summary: string;
  facts: { date: string; text: string }[];
  summarised_at: string | null;
  rebuild_requested_at: string | null;
}

export interface PageItemLine {
  id: string;
  type: string;
  date: string | null;
  title: string;
  line: string;
}

export interface PageSummaryStore {
  /** public.pages_to_summarise: due pages, rebuilds first, at most `limit`. */
  due(userId: string, limit: number): Promise<PageRow[]>;
  /** The page's items; only those changed since `since` when given. Newest first, at most 40. */
  items(pageId: string, since: string | null): Promise<PageItemLine[]>;
  save(
    pageId: string,
    row: { summary: string; facts: { date: string; text: string }[] },
  ): Promise<void>;
  /** Reading items on the page (Task 16.5); optional for older fakes. */
  readingCount?(pageId: string): Promise<number>;
  /** A topic page's collation and per-link notes (Task 16.5). */
  saveTopic?(
    pageId: string,
    row: {
      summary: string;
      collation: { overlaps: string[]; open_questions: string[]; next_step: string };
      notes: { item_id: string; note: string }[];
    },
  ): Promise<void>;
}

/** A topic is collated once it has this many reading items (Task 16.5). */
export const TOPIC_MIN_READING = 3;
export const TOPIC_WORDS = 200;

export const PAGES_PER_NIGHT = 20;
export const PAGE_WORDS = 150;
export const MAX_FACTS = 8;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Facts with a real date and words, newest first, at most 8. */
export function cleanFacts(
  facts: { date: string; text: string }[],
): { date: string; text: string }[] {
  return facts
    .map((f) => ({ date: f.date.trim(), text: f.text.replace(/\s+/g, ' ').trim().slice(0, 140) }))
    .filter((f) => DATE.test(f.date) && f.text.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_FACTS);
}

/**
 * Nightly page summaries (Task 14.5): for each due page, the current summary
 * and facts plus the items changed since the last summary in, a new summary
 * out. A rebuild (or a page never summarised) starts from every item.
 */
export async function runPageSummaries(
  userId: string,
  deps: { store: PageSummaryStore; ai: AIClient; usage: UsageStore },
): Promise<{ built: string[]; failed: string[] }> {
  const built: string[] = [];
  const failed: string[] = [];
  for (const page of await deps.store.due(userId, PAGES_PER_NIGHT)) {
    const rebuild = page.rebuild_requested_at !== null || page.summarised_at === null;
    if (page.kind === 'topic' && deps.store.readingCount && deps.store.saveTopic) {
      // A topic page collates its reading once it has 3 links; before that it waits.
      if ((await deps.store.readingCount(page.id)) < TOPIC_MIN_READING) continue;
      const links = (await deps.store.items(page.id, rebuild ? null : page.summarised_at)).filter(
        (i) => i.type === 'reading',
      );
      const res = await callAI(
        { client: deps.ai, store: deps.usage },
        {
          userId,
          task: 'topic_collate',
          tier: 'small',
          system: [TOPIC_SYSTEM],
          messages: [
            {
              role: 'user',
              content: buildTopicMessage({
                topic: page.name,
                summary: rebuild ? '' : page.summary,
                links,
              }),
            },
          ],
          schema: TopicResult,
          maxTokens: 2500,
          background: true,
        },
      );
      if (!res.ok || !res.data.summary.trim()) {
        failed.push(page.id);
        if (!res.ok && res.error_code === 'cap_reached') break;
        continue;
      }
      const known = new Set(links.map((l) => l.id));
      const line = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
      await deps.store.saveTopic(page.id, {
        summary: clampWords(res.data.summary, TOPIC_WORDS),
        collation: {
          overlaps: res.data.overlaps
            .map((o) => line(o, 200))
            .filter(Boolean)
            .slice(0, 4),
          open_questions: res.data.open_questions
            .map((o) => line(o, 200))
            .filter(Boolean)
            .slice(0, 4),
          next_step: line(res.data.next_step, 200),
        },
        notes: res.data.notes
          .filter((n) => known.has(n.item_id))
          .map((n) => ({ item_id: n.item_id, note: line(n.note, 160) })),
      });
      built.push(page.id);
      continue;
    }
    const items = await deps.store.items(page.id, rebuild ? null : page.summarised_at);
    const res = await callAI(
      { client: deps.ai, store: deps.usage },
      {
        userId,
        task: 'page_summary',
        tier: 'small',
        system: [PAGE_SYSTEM],
        messages: [
          {
            role: 'user',
            content: buildPageMessage({
              page: { kind: page.kind, name: page.name },
              summary: rebuild ? '' : page.summary,
              facts: rebuild ? [] : page.facts,
              items,
            }),
          },
        ],
        schema: PageSummaryResult,
        maxTokens: 1500,
        background: true,
      },
    );
    if (!res.ok || !res.data.summary.trim()) {
      failed.push(page.id);
      if (!res.ok && res.error_code === 'cap_reached') break;
      continue;
    }
    await deps.store.save(page.id, {
      summary: clampWords(res.data.summary, PAGE_WORDS),
      facts: cleanFacts(res.data.facts),
    });
    built.push(page.id);
  }
  return { built, failed };
}
