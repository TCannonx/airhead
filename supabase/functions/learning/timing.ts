import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { buildTimingMessage, TIMING_SYSTEM } from '../_shared/prompts/timing.v1.ts';
import { TimingFact } from '../_shared/schemas/history.ts';

/** One outcome of a planner nudge, as the learning pass reads it (Task 17.2). */
export interface Outcome {
  kind: string;
  page_id: string | null;
  page_name: string | null;
  outcome: 'acted' | 'snoozed' | 'dismissed' | 'ignored';
  send_at: string;
  snoozed_to: string | null;
  outcome_at: string;
}

export interface Pattern {
  kind: string;
  page_id: string | null;
  page_name: string | null;
  direction: 'later' | 'earlier';
  shift_minutes: number;
  examples: { sent: string; moved_to: string }[];
}

export interface LivePref {
  id: string;
  kind: string;
  page_id: string | null;
  direction: 'later' | 'earlier';
  fact_id: string | null;
  contradictions: number;
  checked_until: string;
}

export interface TimingStore {
  /** Planner nudge outcomes of the last 8 weeks, oldest first, tagged with their series/place/person page. */
  outcomes(userId: string): Promise<Outcome[]>;
  live(userId: string): Promise<LivePref[]>;
  /** Saves the fact through the memory path (an active everyday fact) and the preference. */
  learn(userId: string, p: Pattern, fact: string): Promise<void>;
  /** Records contradictions seen up to `until`; archives the preference and its fact at 3. */
  contradict(pref: LivePref, count: number, until: string, archive: boolean): Promise<void>;
}

const WINDOW = 5;
const NEEDED = 3;
export const CONTRADICTIONS_TO_ARCHIVE = 3;

const shift = (o: Outcome) =>
  o.outcome === 'snoozed' && o.snoozed_to
    ? (Date.parse(o.snoozed_to) - Date.parse(o.send_at)) / 60_000
    : 0;

/**
 * The pattern rule (Task 17.2): among the last 5 outcomes for the same kind and
 * page, at least 3 snoozes in the same direction.
 */
export function findPatterns(outcomes: Outcome[]): Pattern[] {
  const groups = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const key = `${o.kind}|${o.page_id ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const out: Pattern[] = [];
  for (const list of groups.values()) {
    const last = list.slice(-WINDOW);
    for (const direction of ['later', 'earlier'] as const) {
      const moved = last.filter((o) => (direction === 'later' ? shift(o) > 0 : shift(o) < 0));
      if (moved.length < NEEDED) continue;
      const shifts = moved.map(shift).sort((a, b) => a - b);
      const first = last[0] as Outcome;
      out.push({
        kind: first.kind,
        page_id: first.page_id,
        page_name: first.page_name,
        direction,
        shift_minutes: Math.round(shifts[Math.floor(shifts.length / 2)] ?? 0),
        examples: moved.slice(-3).map((o) => ({ sent: o.send_at, moved_to: o.snoozed_to ?? '' })),
      });
    }
  }
  return out;
}

/** An outcome after the preference that goes against it: acted on as sent, or snoozed the other way. */
export function contradicts(o: Outcome, pref: Pick<LivePref, 'direction'>): boolean {
  if (o.outcome === 'acted') return true;
  const s = shift(o);
  return pref.direction === 'later' ? s < 0 : s > 0;
}

/**
 * The learning pass for timing (Task 17.2): new patterns are worded as facts
 * (one small call each) and saved through the memory path; live preferences
 * are checked against later outcomes and archived after 3 contradictions.
 */
export async function runTimingPrefs(
  userId: string,
  now: Date,
  deps: { store: TimingStore; ai: AIClient; usage: UsageStore },
): Promise<{ learned: number; archived: number }> {
  const outcomes = await deps.store.outcomes(userId);
  const live = await deps.store.live(userId);
  let archived = 0;
  for (const pref of live) {
    const later = outcomes.filter(
      (o) =>
        o.kind === pref.kind && o.page_id === pref.page_id && o.outcome_at > pref.checked_until,
    );
    if (!later.length) continue;
    const count = pref.contradictions + later.filter((o) => contradicts(o, pref)).length;
    const archive = count >= CONTRADICTIONS_TO_ARCHIVE;
    await deps.store.contradict(pref, count, now.toISOString(), archive);
    if (archive) archived++;
  }
  const known = new Set(
    live.filter((p) => !archived || true).map((p) => `${p.kind}|${p.page_id ?? ''}`),
  );
  let learned = 0;
  for (const p of findPatterns(outcomes)) {
    if (known.has(`${p.kind}|${p.page_id ?? ''}`)) continue;
    const res = await callAI(
      { client: deps.ai, store: deps.usage },
      {
        userId,
        task: 'timing_pref',
        tier: 'small',
        system: [TIMING_SYSTEM],
        messages: [{ role: 'user', content: buildTimingMessage(p) }],
        schema: TimingFact,
        maxTokens: 300,
        background: true,
      },
    );
    if (!res.ok) {
      if (res.error_code === 'cap_reached') break;
      continue;
    }
    const fact = res.data.fact.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!fact) continue;
    await deps.store.learn(userId, p, fact);
    learned++;
  }
  return { learned, archived };
}
