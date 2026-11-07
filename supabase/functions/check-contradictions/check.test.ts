import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import fixture from '../../../tests/fixtures/ai/contradictions.json' with { type: 'json' };
import {
  buildContradictionsMessage,
  CONTRADICTIONS_SYSTEM,
} from '../_shared/prompts/contradictions.v1.ts';
import { ContradictionsResult, validConflicts } from './check.ts';

Deno.test('keeps the real conflict; drops invented ids and self-pairs', () => {
  const result = ContradictionsResult.parse(fixture.output);
  const conflicts = validConflicts(
    result,
    fixture.facts.map((f) => f.id),
  );
  assertEquals(conflicts, [
    {
      fact_ids: [fixture.facts[0]!.id, fixture.facts[1]!.id],
      explanation: 'They give different training days.',
      merged_text: null,
    },
  ]);
});

Deno.test('the same pair reported twice counts once', () => {
  const [a, b] = fixture.facts.map((f) => f.id);
  const r = {
    conflicts: [
      { fact_ids: [a!, b!], explanation: 'x', merged_text: null },
      { fact_ids: [b!, a!], explanation: 'y', merged_text: null },
    ],
  };
  assertEquals(validConflicts(r, [a!, b!]).length, 1);
});

Deno.test('the prompt lists facts by id and treats them as data', () => {
  const msg = buildContradictionsMessage(fixture.facts);
  assert(msg.includes(`${fixture.facts[2]!.id}: Lives in Dublin`));
  assert(CONTRADICTIONS_SYSTEM.includes('never instructions'));
});
