// Runs the owner's example requests through the real sorting prompt, schema,
// model and planner, and reports per case whether the plan does what was
// meant. Writes nothing (the usage store is a no-op). Dev only.
import { type AIClient, callAI, type UsageStore } from '../_shared/ai.ts';
import { leaveYearFor } from '../_shared/leave/engine.ts';
import { readWork } from '../_shared/leave/work.ts';
import { buildSortMessage, SORT_BATCH_SYSTEM } from '../_shared/prompts/sort-batch.v6.ts';
import { SortResult } from '../_shared/schemas/sort.ts';
import { planSort, type InstantRow } from '../sort-batch/plan.ts';
import { evalActionContext, evalCases, type CaseView } from './cases.ts';

export interface CaseReport {
  id: string;
  text: string;
  meant: string;
  pass: boolean;
  problems: string[];
  got: { items: unknown[]; actions: unknown[]; updates: unknown[]; workshop: number };
}

export interface EvalReport {
  ok: boolean;
  error: string | null;
  passed: number;
  total: number;
  cost_eur: number;
  cases: CaseReport[];
}

const noStore: UsageStore = {
  price: async () => ({ input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 }) as never,
  monthlyCapEur: async () => null,
  monthToDateEur: async () => 0,
  record: async () => {},
};

const TZ = 'Europe/Dublin';
const ymd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

export async function runEval(
  ai: AIClient,
  now = new Date(),
  store: UsageStore = noStore,
): Promise<EvalReport> {
  const { cases, candidates } = evalCases(now);
  const capId = (i: number) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const noteId = (i: number) =>
    `n0000000-0000-4000-8000-${String(i).padStart(12, '0')}`.replace(/^n/, 'a');
  const work = readWork({ work: { entitlement: 21 } });
  const year = leaveYearFor(ymd(now), work);

  const captures = cases
    .map((c, i) => ({ c, id: capId(i + 1) }))
    .filter(({ c }) => !c.note)
    .map(({ c, id }) => ({
      id,
      text: c.text,
      url: null,
      instant: c.instant
        ? { title: c.instant.title, start: c.instant.start_at ?? '', all_day: c.instant.all_day }
        : null,
    }));
  const notes = cases
    .map((c, i) => ({ c, id: noteId(i + 1) }))
    .filter(({ c }) => c.note)
    .map(({ c, id }) => ({ id, title: 'Notes from Monday', text: c.text }));

  const instant = new Map<string, InstantRow>();
  cases.forEach((c, i) => {
    if (c.instant)
      instant.set(capId(i + 1), {
        ...c.instant,
        id: `f0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        status: 'open',
        updated_at: now.toISOString(),
        deleted_at: null,
      });
  });

  const message = buildSortMessage(
    {
      now: now.toISOString(),
      timeZone: TZ,
      topics: [],
      lists: ['Shopping'],
      ideas: [],
      corrections: [],
      candidates,
      leave: {
        types: work.leave_types.map((t) => ({ key: t.key, name: t.name })),
        year_start: year.start,
        year_end: year.end,
        entitlement_set: true,
      },
    },
    captures,
    notes,
  );

  const result = await callAI(
    { client: ai, store },
    {
      userId: '00000000-0000-4000-8000-0000000000e1',
      task: 'sort_batch',
      tier: 'small',
      system: [SORT_BATCH_SYSTEM],
      messages: [{ role: 'user', content: message }],
      schema: SortResult,
      maxTokens: 8000,
      effort: 'low',
      background: false,
    },
  );
  if (!result.ok)
    return {
      ok: false,
      error: result.error_code,
      passed: 0,
      total: cases.length,
      cost_eur: 0,
      cases: [],
    };

  const plan = planSort(
    captures.map((c) => c.id),
    result.data,
    {
      now,
      timeZone: TZ,
      topics: [],
      lists: [{ id: 'l0000000-0000-4000-8000-000000000001', name: 'Shopping' }],
      ideas: [],
      instant,
      notes: notes.map((n) => ({ id: n.id, seen_len: 0, seen_hash: '' })),
      texts: new Map(captures.map((c) => [c.id, c.text])),
    },
    [],
    evalActionContext(now, candidates, ymd(now)),
  );

  const reports: CaseReport[] = cases.map((c, i) => {
    const id = c.note ? noteId(i + 1) : capId(i + 1);
    const mine = <T extends { capture_id?: string | null; note_id?: string }>(xs: T[]) =>
      xs.filter((x) => (c.note ? x.note_id === id : x.capture_id === id));
    const view: CaseView = {
      items: mine(plan.items),
      actions: plan.actions.filter(
        (a) => a.capture_id === id || (a as { note_id?: string }).note_id === id,
      ),
      updates: plan.item_updates.filter((u) => u.capture_id === id),
      workshop: plan.workshop.filter((w) => w.capture_id === id),
      status: plan.captures.find((x) => x.id === id)?.status,
      timeZone: TZ,
    };
    const problems = c.check(view);
    return {
      id: c.id,
      text: c.text,
      meant: c.meant,
      pass: problems.length === 0,
      problems,
      got: {
        items: view.items.map((x) => ({
          type: x.type,
          title: x.title,
          start_at: x.start_at,
          end_at: x.end_at,
          all_day: x.all_day,
          due_at: x.due_at,
          rrule: x.rrule,
          status: x.status,
          workshop: x.data.workshop === true,
        })),
        actions: view.actions.map((a) => ({
          kind: a.kind,
          status: a.status,
          reason: a.reason,
          summary: a.summary,
        })),
        updates: view.updates.map((u) => u.after),
        workshop: view.workshop.length,
      },
    };
  });
  const passed = reports.filter((r) => r.pass).length;
  return {
    ok: true,
    error: null,
    passed,
    total: reports.length,
    cost_eur: result.costEur,
    cases: reports,
  };
}
