import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { addDays } from '../_shared/holidays/easter.ts';
import { buildDayDigestMessage, DAY_DIGEST_SYSTEM } from '../_shared/prompts/day-digest.v1.ts';
import { DayDigestResult } from '../_shared/schemas/history.ts';

/** What public.day_digest_source returns for one local day. */
export interface DaySource {
  date: string;
  weekday: string;
  captured: { id: string; type: string; title: string }[];
  done: { id: string; title: string }[];
  events: { id: string; title: string; time: string | null; location: string | null }[];
  missed: { id: string; title: string }[];
}

export interface DayDigestStore {
  /** Local dates that need building: yesterday if it has no summary, then stale ones. */
  datesToBuild(userId: string, yesterday: string): Promise<string[]>;
  source(userId: string, localDate: string): Promise<DaySource>;
  save(
    userId: string,
    localDate: string,
    row: { digest: string; item_ids: string[] },
  ): Promise<void>;
}

export const NOTHING_RECORDED = 'Nothing recorded.';
export const MAX_WORDS = 120;
/** Rebuilt at most this many days a night (yesterday plus stale ones). */
export const MAX_DAYS_PER_NIGHT = 7;

/** Every item id a summary came from, once each. */
export function sourceIds(s: DaySource): string[] {
  return [...new Set([...s.captured, ...s.done, ...s.events, ...s.missed].map((x) => x.id))];
}

export function isEmptyDay(s: DaySource): boolean {
  return sourceIds(s).length === 0;
}

/** At most `max` words, ending with a full stop. */
export function clampWords(text: string, max = MAX_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return `${words
    .slice(0, max)
    .join(' ')
    .replace(/[,;:]$/, '')}…`;
}

/**
 * Builds day summaries (Task 14.1): yesterday's, then any marked stale, each
 * from its sources. An empty day gets "Nothing recorded." with no AI call.
 * A failed call leaves the day to be tried the next night.
 */
export async function runDayDigests(
  userId: string,
  today: string,
  deps: { store: DayDigestStore; ai: AIClient; usage: UsageStore },
): Promise<{ built: string[]; failed: string[] }> {
  const yesterday = addDays(today, -1);
  const dates = (await deps.store.datesToBuild(userId, yesterday)).slice(0, MAX_DAYS_PER_NIGHT);
  const built: string[] = [];
  const failed: string[] = [];
  for (const date of dates) {
    const source = await deps.store.source(userId, date);
    if (isEmptyDay(source)) {
      await deps.store.save(userId, date, { digest: NOTHING_RECORDED, item_ids: [] });
      built.push(date);
      continue;
    }
    const res = await callAI(
      { client: deps.ai, store: deps.usage },
      {
        userId,
        task: 'day_digest',
        tier: 'small',
        system: [DAY_DIGEST_SYSTEM],
        messages: [{ role: 'user', content: buildDayDigestMessage(source) }],
        schema: DayDigestResult,
        maxTokens: 1000,
        background: true,
      },
    );
    if (!res.ok || !res.data.digest.trim()) {
      failed.push(date);
      if (res.ok === false && res.error_code === 'cap_reached') break;
      continue;
    }
    await deps.store.save(userId, date, {
      digest: clampWords(res.data.digest),
      item_ids: sourceIds(source),
    });
    built.push(date);
  }
  return { built, failed };
}
