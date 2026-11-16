import type { AIClient, UsageStore } from '../_shared/ai.ts';
import { runAsk } from '../ask/run.ts';
import type { CaseReport } from './run.ts';

const SOURCE = 'b1490000-0000-4000-8000-000000000001';

/**
 * Ask Airhead over history (Task 14.9): a question about something three months
 * old, with the passage and its page given as search would find them, must be
 * answered from that passage and link to its item. One small-tier call.
 */
export async function runAskEval(
  ai: AIClient,
  now: Date,
  store: UsageStore,
): Promise<{ ok: boolean; error: string | null; cost_eur: number; cases: CaseReport[] }> {
  const then = new Date(now.getTime() - 92 * 86_400_000);
  const month = then.toLocaleDateString('en-IE', { month: 'long', timeZone: 'Europe/Dublin' });
  const text = `What did we decide about the kitchen extension back in ${month}?`;
  const passages = [
    {
      item_id: SOURCE,
      content: `Kitchen extension meeting with Trevor (${then.toISOString().slice(0, 10)}): decided to go with the smaller extension, budget capped at €40,000, builder to start in spring.`,
    },
    {
      item_id: 'b1490000-0000-4000-8000-000000000002',
      content: 'Shopping: milk, bin bags, tiles samples.',
    },
  ];
  let cost = 0;
  const res = await runAsk(text, '00000000-0000-4000-8000-0000000000e1', {
    ai,
    store: {
      ...store,
      record: async (r) => {
        cost += r.cost_eur;
        await store.record(r);
      },
    },
    embed: async () => [],
    search: async () => passages,
    items: async (ids) =>
      new Map(
        ids.map((id) => [
          id,
          id === SOURCE
            ? { title: 'Kitchen extension meeting', type: 'meeting' }
            : { title: 'Shopping', type: 'list_entry' },
        ]),
      ),
    tier: async () => 'small',
    pages: async () => [
      {
        kind: 'project',
        name: 'Kitchen extension',
        summary:
          'Planning a kitchen extension with Trevor since the summer; smaller option chosen.',
      },
    ],
  });
  if (!res.ok) return { ok: false, error: res.error_code, cost_eur: cost, cases: [] };
  const problems = [
    ...(res.sources.some((s) => s.item_id === SOURCE)
      ? []
      : ['the meeting is not linked as a source']),
    ...(/small|40/i.test(res.answer) ? [] : ['the answer does not say what was decided']),
  ];
  return {
    ok: true,
    error: null,
    cost_eur: cost,
    cases: [
      {
        id: 'ask-three-months',
        kind: 'ask',
        text,
        meant: 'Answered from the three-month-old meeting, with a link to it.',
        pass: problems.length === 0,
        problems,
        got: {
          items: [{ answer: res.answer, sources: res.sources }],
          actions: [],
          updates: [],
          workshop: 0,
          follow_ups: [],
        },
      },
    ],
  };
}
