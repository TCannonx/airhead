import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { fitTasks, freeGaps, slotText, toMinutes } from './slots.ts';

for (const file of ['slots.ts', 'fallback.ts']) {
  Deno.test(`the server copy of ${file} is identical to the app's`, async () => {
    const here = await Deno.readTextFile(new URL(`./${file}`, import.meta.url));
    const app = await Deno.readTextFile(
      new URL(`../../../../src/lib/today/${file}`, import.meta.url),
    );
    assertEquals(here, app);
  });
}

Deno.test('slots work on the server too', () => {
  const gaps = freeGaps([{ start: toMinutes('09:00'), end: toMinutes('12:20') }], {
    start: toMinutes('08:00'),
    end: toMinutes('21:00'),
  });
  const slot = fitTasks([{ id: 'a', minutes: 30 }], gaps).get('a');
  assertEquals(slot && slotText(slot), '08:00–08:30');
});
