import type { PriceRow, UsageRow } from '../ai/usage';
import type { LearnedRule, MemoryFact } from '../schemas/records';

export const PROFILE_WORD_BUDGET = 400;
const DAY = 86_400_000;
const STALE_DAYS = 90;
const TOKENS_PER_WORD = 4 / 3;
const FILLER = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'on',
  'at',
  'in',
  'of',
  'to',
  'is',
  'are',
  'for',
  'with',
]);

export type Fix =
  | { label: string; action: 'merge_facts'; keep: string; remove: string[] }
  | { label: string; action: 'archive_facts'; ids: string[] }
  | { label: string; action: 'delete_rules'; ids: string[] }
  | { label: string; action: 'disable_rules'; ids: string[] }
  | { label: string; action: 'open_memory' }
  | { label: string; action: 'sync_now' };

export interface Finding {
  id: string;
  kind:
    | 'profile_size'
    | 'duplicate_facts'
    | 'stale_facts'
    | 'pending_approvals'
    | 'disabled_rules'
    | 'rare_rules'
    | 'request_growth'
    | 'sync'
    | 'cost_trend';
  title: string;
  detail: string;
  fix?: Fix;
  /** Estimated saving if fixed: words trimmed from every call, and euros a month. */
  saving?: { words: number; eurPerMonth: number };
}

export interface CheckupInput {
  facts: MemoryFact[];
  rules: LearnedRule[];
  usage: UsageRow[];
  prices: PriceRow[];
  pendingSync: number;
  lastSyncedAt: string | null;
  now?: Date;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));

/** Jaccard similarity of meaningful words (0..1). */
export function similarity(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 && y.size === 0) return 1;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both);
}

export const profileWords = (facts: MemoryFact[]) =>
  facts.reduce((n, f) => n + f.text.trim().split(/\s+/).filter(Boolean).length, 0);

const lastUse = (f: MemoryFact) => Date.parse(f.last_used_at ?? f.created_at);

/**
 * Euros a month saved by sending `words` fewer words with every call. The
 * profile sits in the cached prefix, so it is billed at the cache-read price of
 * the small model, for as many calls as last month had.
 */
export function wordsSavingEur(
  words: number,
  usage: UsageRow[],
  prices: PriceRow[],
  now = new Date(),
): number {
  const since = now.getTime() - 30 * DAY;
  const calls = usage.filter((r) => Date.parse(r.created_at) >= since).length;
  const price =
    prices.find((p) => p.model === 'claude-haiku-5-5' && p.user_id) ??
    prices.find((p) => p.model === 'claude-haiku-5-5') ??
    prices[0];
  if (!price || !calls) return 0;
  const usd = (words * TOKENS_PER_WORD * calls * Number(price.cache_read_per_mtok)) / 1_000_000;
  return Math.round(usd * Number(price.eur_rate) * 1e6) / 1e6;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Free, code-only memory check-up (Task 3.10). */
export function runCheckup(input: CheckupInput): Finding[] {
  const now = input.now ?? new Date();
  const findings: Finding[] = [];
  const live = input.facts.filter((f) => !f.deleted_at);
  const active = live.filter((f) => f.status === 'active');
  const saving = (words: number) => ({
    words,
    eurPerMonth: wordsSavingEur(words, input.usage, input.prices, now),
  });

  // Profile size against its budget (least recently used don't fit).
  const words = profileWords(active);
  if (words > PROFILE_WORD_BUDGET) {
    const byUse = [...active].sort((a, b) => lastUse(b) - lastUse(a));
    const overflow: MemoryFact[] = [];
    let kept = 0;
    for (const f of byUse) {
      const n = profileWords([f]);
      if (kept + n <= PROFILE_WORD_BUDGET) kept += n;
      else overflow.push(f);
    }
    findings.push({
      id: 'profile_size',
      kind: 'profile_size',
      title: 'Your memory profile is over its budget',
      detail: `${words} words in active facts; about ${PROFILE_WORD_BUDGET} are sent with each call, so the least used ${plural(overflow.length, 'fact')} are never sent.`,
      fix: {
        label: `Archive ${plural(overflow.length, 'fact')}`,
        action: 'archive_facts',
        ids: overflow.map((f) => f.id),
      },
      saving: saving(profileWords(overflow)),
    });
  }

  // Near-duplicates: keep the longer, remove the other.
  const seen = new Set<string>();
  for (const [i, a] of active.entries()) {
    for (const b of active.slice(i + 1)) {
      if (seen.has(a.id) || seen.has(b.id) || similarity(a.text, b.text) < 0.8) continue;
      // Keep the one with more meaningful words; on a tie, the first one.
      const [keep, remove] = tokens(b.text).length > tokens(a.text).length ? [b, a] : [a, b];
      seen.add(remove.id);
      findings.push({
        id: `dup:${remove.id}`,
        kind: 'duplicate_facts',
        title: 'Two facts say the same thing',
        detail: `“${keep.text}” and “${remove.text}”.`,
        fix: { label: 'Merge', action: 'merge_facts', keep: keep.id, remove: [remove.id] },
        saving: saving(profileWords([remove])),
      });
    }
  }

  // Stale: unused for 90+ days.
  const stale = active.filter(
    (f) => !seen.has(f.id) && now.getTime() - lastUse(f) >= STALE_DAYS * DAY,
  );
  if (stale.length) {
    findings.push({
      id: 'stale_facts',
      kind: 'stale_facts',
      title: `${plural(stale.length, 'fact')} not used for 90 days`,
      detail: stale.map((f) => `“${f.text}”`).join(', '),
      fix: {
        label: `Archive ${plural(stale.length, 'fact')}`,
        action: 'archive_facts',
        ids: stale.map((f) => f.id),
      },
      saving: saving(profileWords(stale)),
    });
  }

  const pending = live.filter((f) => f.status === 'pending_approval');
  if (pending.length) {
    findings.push({
      id: 'pending_approvals',
      kind: 'pending_approvals',
      title: `${plural(pending.length, 'fact')} waiting for your OK`,
      detail: 'Facts about people and personal details are only used once you approve them.',
      fix: { label: 'Review', action: 'open_memory' },
    });
  }

  // Rules: switched off (corrected), or rarely used after two months.
  const rules = input.rules.filter((r) => !r.deleted_at);
  const off = rules.filter((r) => !r.enabled);
  if (off.length) {
    findings.push({
      id: 'disabled_rules',
      kind: 'disabled_rules',
      title: `${plural(off.length, 'learned rule')} switched off`,
      detail: off.map((r) => `“${r.pattern} …”`).join(', '),
      fix: {
        label: `Delete ${plural(off.length, 'rule')}`,
        action: 'delete_rules',
        ids: off.map((r) => r.id),
      },
    });
  }
  const rare = rules.filter(
    (r) => r.enabled && r.hits <= 5 && now.getTime() - Date.parse(r.created_at) >= 60 * DAY,
  );
  if (rare.length) {
    findings.push({
      id: 'rare_rules',
      kind: 'rare_rules',
      title: `${plural(rare.length, 'learned rule')} rarely used`,
      detail: rare.map((r) => `“${r.pattern} …” (${r.hits}×)`).join(', '),
      fix: {
        label: `Switch off ${plural(rare.length, 'rule')}`,
        action: 'disable_rules',
        ids: rare.map((r) => r.id),
      },
    });
  }

  // Average input tokens per task: last 30 days vs the 30 before.
  const avg = (rows: UsageRow[]) =>
    rows.length ? rows.reduce((n, r) => n + r.input_tokens, 0) / rows.length : 0;
  const tasks = new Set(input.usage.map((r) => r.task));
  for (const task of tasks) {
    const age = (r: UsageRow) => (now.getTime() - Date.parse(r.created_at)) / DAY;
    const recent = avg(input.usage.filter((r) => r.task === task && age(r) < 30));
    const before = avg(input.usage.filter((r) => r.task === task && age(r) >= 30 && age(r) < 60));
    if (before > 0 && recent > before * 1.25) {
      const fmt = (n: number) => Math.round(n).toLocaleString('en-IE');
      findings.push({
        id: `growth:${task}`,
        kind: 'request_growth',
        title: `${task.replace('_', ' ')} requests are getting bigger`,
        detail: `Average input ${fmt(before)} → ${fmt(recent)} tokens (last 30 days vs the 30 before).`,
      });
    }
  }

  // Sync health.
  const syncAgeDays = input.lastSyncedAt
    ? (now.getTime() - Date.parse(input.lastSyncedAt)) / DAY
    : Infinity;
  if (input.pendingSync > 50 || syncAgeDays > 1) {
    findings.push({
      id: 'sync',
      kind: 'sync',
      title: 'This device is behind on syncing',
      detail:
        input.pendingSync > 50
          ? `${input.pendingSync} changes are waiting to be sent.`
          : 'The last successful sync was over a day ago.',
      fix: { label: 'Sync now', action: 'sync_now' },
    });
  }

  return findings;
}
