import { describe, expect, it } from 'vitest';
import { baseRecord } from '../db/repository';
import type { PriceRow, UsageRow } from '../ai/usage';
import type { LearnedRule, MemoryFact } from '../schemas/records';
import { profileWords, runCheckup, similarity, wordsSavingEur } from './checkup';

const U = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const fact = (text: string, over: Partial<MemoryFact> = {}): MemoryFact => ({
  ...baseRecord(U),
  text,
  category: 'everyday',
  status: 'active',
  source_capture_id: null,
  last_used_at: daysAgo(1),
  created_at: daysAgo(200),
  ...over,
});
const rule = (pattern: string, over: Partial<LearnedRule> = {}): LearnedRule => ({
  ...baseRecord(U),
  pattern,
  match_kind: 'prefix',
  result: { type: 'task' },
  hits: 10,
  enabled: true,
  created_at: daysAgo(100),
  ...over,
});
const usage = (task: string, created: number, input_tokens: number): UsageRow => ({
  task,
  tier: 'small',
  model: 'claude-haiku-5-5',
  cost_eur: 0.001,
  ok: true,
  error_code: null,
  created_at: daysAgo(created),
  input_tokens,
  output_tokens: 100,
  cache_read_tokens: 0,
});
const PRICES: PriceRow[] = [
  {
    id: 'p',
    user_id: null,
    model: 'claude-haiku-5-5',
    input_per_mtok: 0.1,
    output_per_mtok: 0.5,
    cache_read_per_mtok: 0.01,
    cache_write_per_mtok: 0.125,
    eur_rate: 1,
  },
];
const base = {
  facts: [],
  rules: [],
  usage: [],
  prices: PRICES,
  pendingSync: 0,
  lastSyncedAt: daysAgo(0),
  now: NOW,
};

describe('similarity', () => {
  it('ignores case, punctuation and filler words', () => {
    expect(similarity('Trains on Tuesdays at 7pm.', 'trains on tuesdays at 7pm')).toBe(1);
    expect(similarity('Supports Bohemians', 'Lives in Dublin')).toBe(0);
    const partial = similarity('Trains on Tuesdays at 7pm', 'Trains on Tuesdays at 7.30pm');
    expect(partial).toBeGreaterThan(0.3);
    expect(partial).toBeLessThan(0.8); // different times: not merged
  });
});

describe('runCheckup', () => {
  it('a clean memory has no findings', () => {
    expect(runCheckup({ ...base, facts: [fact('Lives in Dublin')], rules: [rule('buy')] })).toEqual(
      [],
    );
  });

  it('flags near-duplicate facts, with a merge fix and its saving', () => {
    const a = fact('Trains on Tuesdays and Thursdays at 7pm');
    const b = fact('trains on tuesdays and thursdays at 7pm.');
    const [f] = runCheckup({ ...base, facts: [a, b] });
    expect(f).toMatchObject({
      kind: 'duplicate_facts',
      fix: { action: 'merge_facts', keep: a.id, remove: [b.id] },
    });
    expect(f?.saving?.words).toBe(profileWords([b]));
  });

  it('flags facts unused for 90+ days, with an archive fix', () => {
    const stale = [
      fact('Old one', { last_used_at: daysAgo(120) }),
      fact('Older one', { last_used_at: null, created_at: daysAgo(400) }),
    ];
    const f = runCheckup({ ...base, facts: [...stale, fact('Fresh')] }).find(
      (x) => x.kind === 'stale_facts',
    );
    expect(f?.fix).toEqual({
      label: 'Archive 2 facts',
      action: 'archive_facts',
      ids: stale.map((s) => s.id),
    });
    expect(f?.title).toMatch(/2 facts/);
  });

  it('flags a profile over its ~400-word budget', () => {
    const long = Array.from({ length: 10 }, (_, i) =>
      fact(`${'word '.repeat(50)}${i}`, { last_used_at: daysAgo(i) }),
    );
    const f = runCheckup({ ...base, facts: long }).find((x) => x.kind === 'profile_size');
    expect(f?.detail).toMatch(/510 words/);
    expect(f?.fix?.action).toBe('archive_facts');
  });

  it('reminds about facts waiting for approval', () => {
    const f = runCheckup({
      ...base,
      facts: [fact('Jim is a close friend', { status: 'pending_approval', category: 'person' })],
    });
    expect(f[0]).toMatchObject({ kind: 'pending_approvals', fix: { action: 'open_memory' } });
  });

  it('flags switched-off and rarely used rules', () => {
    const off = rule('call', { enabled: false });
    const rare = rule('email', { hits: 4, created_at: daysAgo(90) });
    const kinds = runCheckup({ ...base, rules: [off, rare, rule('buy')] }).map((f) => [
      f.kind,
      f.fix?.action,
    ]);
    expect(kinds).toContainEqual(['disabled_rules', 'delete_rules']);
    expect(kinds).toContainEqual(['rare_rules', 'disable_rules']);
  });

  it('flags a request size that grew over 25% month on month', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => usage('sort_batch', 40, 1000)),
      ...Array.from({ length: 5 }, () => usage('sort_batch', 5, 1500)),
    ];
    const f = runCheckup({ ...base, usage: rows }).find((x) => x.kind === 'request_growth');
    expect(f?.detail).toMatch(/1,000 → 1,500/);
  });

  it('flags a sync backlog or a long time since the last sync', () => {
    expect(runCheckup({ ...base, pendingSync: 80 })[0]).toMatchObject({
      kind: 'sync',
      fix: { action: 'sync_now' },
    });
    expect(runCheckup({ ...base, lastSyncedAt: daysAgo(3) })[0]?.kind).toBe('sync');
  });
});

describe('wordsSavingEur', () => {
  it('uses the current price table and last month’s call count (profile is a cached read)', () => {
    // 150 words ≈ 200 tokens × 300 calls × $0.01 per M (cache read) × €1/$ = €0.0006
    const rows = Array.from({ length: 300 }, () => usage('sort_batch', 10, 1000));
    expect(wordsSavingEur(150, rows, PRICES, NOW)).toBeCloseTo(0.0006, 6);
  });
});
