import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { balanceFor, leaveYearFor } from './engine.ts';
import { DEFAULT_WORK, readWork } from './work.ts';

Deno.test('opening_used counts as taken; readWork keeps only valid entries', () => {
  const work = readWork({
    work: { entitlement: 21, opening_used: { '2025-12-01': 11.5, bad: 3, '2026-12-01': -1 } },
  });
  assertEquals(work.opening_used, { '2025-12-01': 11.5 });
  const b = balanceFor(leaveYearFor('2026-11-08', work), [], work, '2026-11-08');
  assertEquals([b.taken, b.remaining], [11.5, 9.5]);
  assertEquals(DEFAULT_WORK.opening_used, {});
});
