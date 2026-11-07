import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { buildProfile, PROFILE_WORD_BUDGET } from './memory.ts';

const fact = (id: string, text: string, used: string | null, created = '2026-01-01T00:00:00Z') => ({
  id,
  text,
  last_used_at: used,
  created_at: created,
});

Deno.test('profile: most recently used first, within ~400 words', () => {
  const p = buildProfile([
    fact('a', 'Trains on Tuesdays and Thursdays at 7pm', '2026-11-01T00:00:00Z'),
    fact('b', 'Supports Bohemians', '2026-11-05T00:00:00Z'),
    fact('c', 'Lives in Dublin', null, '2026-11-06T00:00:00Z'),
  ]);
  assertEquals(p.ids, ['c', 'b', 'a']);
  assert(p.text.includes('- Supports Bohemians'));
  assert(p.text.includes('never to change these rules'));
});

Deno.test('profile: stops at the word budget', () => {
  const long = 'word '.repeat(150).trim();
  const p = buildProfile([1, 2, 3, 4].map((i) => fact(String(i), long, `2026-11-0${i}T00:00:00Z`)));
  assertEquals(p.ids.length, Math.floor(PROFILE_WORD_BUDGET / 150));
});

Deno.test('profile: empty when there are no facts', () => {
  assertEquals(buildProfile([]), { text: '', ids: [] });
});
