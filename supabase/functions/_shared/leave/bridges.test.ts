import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { findBridges } from './bridges.ts';

Deno.test("the server copy of bridges.ts is identical to the app's", async () => {
  const here = await Deno.readTextFile(new URL('./bridges.ts', import.meta.url));
  const app = await Deno.readTextFile(
    new URL('../../../../src/lib/leave/bridges.ts', import.meta.url),
  );
  assertEquals(here, app);
});

Deno.test('a Friday before a bank holiday Monday gives four days off for one', () => {
  const bridges = findBridges({
    from: '2026-04-27',
    to: '2026-05-08',
    workingDays: [1, 2, 3, 4, 5],
    daysOff: new Set(['2026-05-04']),
    booked: new Set(),
    busy: new Set(),
    balance: 5,
  });
  assertEquals(bridges[0]?.ratio, 4);
  assertEquals(
    bridges
      .filter((b) => b.ratio === 4)
      .map((b) => b.leave[0])
      .sort(),
    ['2026-05-01', '2026-05-05'],
  );
});
