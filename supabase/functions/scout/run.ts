import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { findFindings, type Finding, type ItemRow } from './findings.ts';
import { buildQueries, type FactIn } from './queries.ts';
import { scoutWeb, type WebIdea } from './web.ts';

export const MAX_CARDS = 5;
export const MAX_WEB_CARDS = 2;

export interface ScoutStore {
  settings(userId: string): Promise<Record<string, unknown>>;
  facts(userId: string): Promise<FactIn[]>;
  items(userId: string): Promise<ItemRow[]>;
  /** Items with tasks made from them or recent Workshop drafts. */
  followedUp(userId: string): Promise<Set<string>>;
  linkedStarts(userId: string): Promise<string[]>;
  /** Titles of open cards, so a run doesn't repeat them. */
  openTitles(userId: string): Promise<Set<string>>;
  saveRun(
    userId: string,
    run: {
      trigger: 'weekly' | 'manual';
      queries: string[];
      searches: number;
      cards: number;
      cost_eur: number;
      status: 'ok' | 'failed';
    },
  ): Promise<string>;
  saveCards(
    userId: string,
    runId: string,
    cards: {
      kind: string;
      title: string;
      body: string;
      source_url: string | null;
      proposed: Record<string, unknown> | null;
    }[],
  ): Promise<void>;
  addNudge(
    userId: string,
    n: { title: string; body: string; url: string; dedupe_key: string },
  ): Promise<void>;
}

/**
 * One Scout run (Task 8.11): findings from the person's own data in code,
 * plus (when a city is set and searches are allowed) one large-tier call
 * that runs the code-built web queries. At most 5 cards, at most 2 of them
 * from the web. Nothing is created until a card is accepted (8.12).
 */
export async function runScout(
  userId: string,
  trigger: 'weekly' | 'manual',
  deps: { store: ScoutStore; ai: AIClient; usage: UsageStore; now?: Date },
): Promise<{ cards: number; queries: string[]; searches: number }> {
  const { store } = deps;
  const now = deps.now ?? new Date();
  const settings = await store.settings(userId);
  const scout = (settings.scout ?? {}) as {
    enabled?: boolean;
    city?: string;
    max_searches?: number;
  };
  const timeZone = typeof settings.time_zone === 'string' ? settings.time_zone : 'Europe/Dublin';
  const [facts, items, followedUp, linkedStarts, openTitles] = await Promise.all([
    store.facts(userId),
    store.items(userId),
    store.followedUp(userId),
    store.linkedStarts(userId),
    store.openTitles(userId),
  ]);

  const findings: Finding[] = findFindings({
    now,
    timeZone,
    items,
    followedUp,
    linkedStarts,
  }).filter((f) => !openTitles.has(f.title));
  const max = Math.max(0, Math.min(3, Number(scout.max_searches ?? 3)));
  const queries = buildQueries(facts, String(scout.city ?? ''), max);
  const web = await scoutWeb(
    userId,
    queries,
    { city: String(scout.city ?? ''), timezone: timeZone },
    { ai: deps.ai, store: deps.usage },
  );
  const webCards = web.ideas
    .filter((i: WebIdea) => !openTitles.has(i.title))
    .slice(0, MAX_WEB_CARDS)
    .map((i) => ({
      kind: 'web',
      title: i.title,
      body: i.body,
      source_url: i.url,
      proposed: { type: 'task', title: i.title },
    }));
  const ownCards = findings.slice(0, MAX_CARDS - webCards.length).map((f) => ({
    kind: f.kind,
    title: f.title,
    body: f.body,
    source_url: null,
    proposed: f.proposed,
  }));
  const cards = [...ownCards, ...webCards].slice(0, MAX_CARDS);

  const runId = await store.saveRun(userId, {
    trigger,
    // The log shows what was actually searched when the model reports it, else what was planned.
    queries: web.searched.length ? web.searched : queries.slice(0, web.searches || queries.length),
    searches: web.searches,
    cards: cards.length,
    cost_eur: web.cost_eur,
    status: web.ok ? 'ok' : 'failed',
  });
  if (cards.length) await store.saveCards(userId, runId, cards);
  if (trigger === 'weekly' && cards.length)
    await store.addNudge(userId, {
      title: `Airhead has ${cards.length} ${cards.length === 1 ? 'idea' : 'ideas'} for you`,
      body: cards[0]?.title ?? '',
      url: '/today',
      dedupe_key: `scout:${now.toISOString().slice(0, 10)}`,
    });
  return { cards: cards.length, queries, searches: web.searches };
}
