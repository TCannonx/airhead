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
      ])
        assert(byId[id]?.pass, `${id}: ${byId[id]?.problems.join('; ')}`);
    } finally {
      Deno.env.delete('ANTHROPIC_BASE_URL');
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
