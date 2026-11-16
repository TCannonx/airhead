// The evaluator's wiring, against the stand-in AI (never the paid API).
import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { createMockServer } from '../../../tests/mock-ai/server.mjs';
import { anthropicClient } from '../_shared/anthropic.ts';
import { runEval } from './run.ts';

Deno.test(
  'the evaluator runs every case through prompt, model and planner and reports each',
  async () => {
    const server = createMockServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as { port: number };
    Deno.env.set('ANTHROPIC_BASE_URL', `http://127.0.0.1:${port}`);
    try {
      const report = await runEval(anthropicClient('test-key'), new Date('2026-11-09T12:00:00Z'));
      assert(report.ok, JSON.stringify(report));
      assertEquals(report.total, report.cases.length);
      assert(report.total >= 14);
      // The stand-in knows some of these phrases; those must pass here too.
      const byId = Object.fromEntries(report.cases.map((c) => [c.id, c]));
      for (const id of [
        'leave-left',
        'training-report',
        'dentist-moved',
        'off-dec',
        'vague',
        'christmas-placeholder',
        'car-insurance',
        'team-night',
      ])
        assert(byId[id]?.pass, `${id}: ${byId[id]?.problems.join('; ')}`);
      // The planner's timing cases (Task 13.9): the stand-in plans like the defaults.
      const plans = report.cases.filter((c) => c.kind === 'plan');
      assertEquals(
        plans.map((c) => c.id),
        [
          'plan-training-bag',
          'plan-dentist',
          'plan-friday-form',
          'plan-early-quiet',
          'plan-empty-day',
        ],
      );
      for (const c of plans) assert(c.pass, `${c.id}: ${c.problems.join('; ')}`);
    } finally {
      Deno.env.delete('ANTHROPIC_BASE_URL');
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

import type { PlanResultT } from '../_shared/schemas/plan.ts';
import { planCases } from './planCases.ts';

Deno.test(
  'planner checks catch a late prepare, a push for an untimed task and a quiet-hours push',
  () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const { cases, ids } = planCases(now);
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    const plan = (itemId: string, nudges: PlanResultT['items'][number]['nudges']): PlanResultT => ({
      items: [
        {
          item_id: itemId,
          occurrence_date: '2026-11-18',
          surface_at: '',
          effort_minutes: 0,
          needs: [],
          prep: [],
          nudges,
          reason: '',
          confidence: 1,
        },
      ],
      tonight: [],
      clashes: [],
      digest_draft: '',
    });
    const n = (
      kind: 'prepare' | 'leave' | 'do',
      at: string,
      delivery: 'push' | 'digest' = 'push',
    ) => ({
      kind,
      at,
      title: 't',
      body: '',
      reason: '',
      delivery,
    });
    // The owner's 07:30 "pack your bag" for 08:00.
    assertEquals(
      byId['plan-training-bag']?.check(plan(ids.training, [n('prepare', '2026-11-18 07:30')]), ids),
      [
        'no prepare the evening before',
        'a prepare inside 45 minutes of the start',
        'no leave before the start',
      ],
    );
    assertEquals(
      byId['plan-friday-form']?.check(plan(ids.form, [n('do', '2026-11-18 09:00')]), ids),
      ['a push for a task with no time'],
    );
    assertEquals(
      byId['plan-early-quiet']?.check(
        plan(ids.early, [n('leave', '2026-11-18 06:50'), n('prepare', '2026-11-18 06:00')]),
        ids,
      ),
      ['another push inside quiet hours'],
    );
  },
);
