import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import {
  buildMonthDigestMessage,
  MONTH_DIGEST_SYSTEM,
} from '../_shared/prompts/month-digest.v1.ts';
import { MonthDigestResult } from '../_shared/schemas/history.ts';
import { clampWords, NOTHING_RECORDED } from './run.ts';

export interface WeekDigest {
  week_start: string;
  digest: string;
}

export interface MonthDigestStore {
  /** First days of months to build: last month if it has no summary, then stale ones. */
  monthsToBuild(userId: string, lastMonth: string): Promise<string[]>;
  /** Weekly digests whose Monday is in the month. */
  weeks(userId: string, month: string): Promise<WeekDigest[]>;
  save(
    userId: string,
    month: string,
    row: { digest: string; week_starts: string[] },
  ): Promise<void>;
}

export const MONTH_WORDS = 150;
const MAX_MONTHS_PER_NIGHT = 3;

/** The first day of the month before `today` (YYYY-MM-DD). */
export function previousMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/**
 * Month summaries (Task 14.2): last month once it has ended, and stale ones,
 * each from its weekly digests with one small call. A month with no weekly
 * digests gets "Nothing recorded." with no call.
 */
export async function runMonthDigests(
  userId: string,
  today: string,
  deps: { store: MonthDigestStore; ai: AIClient; usage: UsageStore },
): Promise<{ built: string[]; failed: string[] }> {
  const months = (await deps.store.monthsToBuild(userId, previousMonth(today))).slice(
    0,
    MAX_MONTHS_PER_NIGHT,
  );
  const built: string[] = [];
  const failed: string[] = [];
  for (const month of months) {
    const weeks = (await deps.store.weeks(userId, month)).filter((w) => w.digest.trim());
    if (!weeks.length) {
      await deps.store.save(userId, month, { digest: NOTHING_RECORDED, week_starts: [] });
      built.push(month);
      continue;
    }
    const res = await callAI(
      { client: deps.ai, store: deps.usage },
      {
        userId,
        task: 'month_digest',
        tier: 'small',
        system: [MONTH_DIGEST_SYSTEM],
        messages: [{ role: 'user', content: buildMonthDigestMessage(month, weeks) }],
        schema: MonthDigestResult,
        maxTokens: 1200,
        background: true,
      },
    );
    if (!res.ok || !res.data.digest.trim()) {
      failed.push(month);
      if (!res.ok && res.error_code === 'cap_reached') break;
      continue;
    }
    await deps.store.save(userId, month, {
      digest: clampWords(res.data.digest, MONTH_WORDS),
      week_starts: weeks.map((w) => w.week_start),
    });
    built.push(month);
  }
  return { built, failed };
}
