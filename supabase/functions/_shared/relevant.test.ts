import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1.0.19';
import type { FactRow } from './memory.ts';
import { keywordFacts, relevantFacts, withRelevant } from './relevant.ts';

const fact = (id: string, text: string): FactRow => ({
  id,
  text,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
});
const FACTS = [
  fact('f1', 'Cycles to work along the canal'),
  fact('f2', 'Allergic to cats'),
  fact('f3', 'Training is Tuesday and Thursday evenings'),
  fact('f4', 'Prefers timber over metal for garden projects'),
];

Deno.test('by embedding: the nearest facts not already in the profile', async () => {
  const asked: number[][] = [];
  const got = await relevantFacts(
    {
      embed: () => Promise.resolve([0.1, 0.9]),
      nearest: (e) => {
        asked.push(e);
        return Promise.resolve([FACTS[0]!, FACTS[3]!]);
      },
    },
    'Build a bike shed in the garden',
    FACTS,
    ['f1'],
  );
  assertEquals(
    got.map((f) => f.id),
    ['f4'],
  );
  assertEquals(asked.length, 1);
});

Deno.test('falls back to keywords when embeddings are missing or fail', async () => {
  assertEquals(
    (await relevantFacts({}, 'Book the garden timber for the shed', FACTS, [])).map((f) => f.id),
    ['f4'],
  );
  const failing = {
    embed: () => Promise.reject(new Error('no model')),
    nearest: () => Promise.resolve([]),
  };
  assertEquals(
    (await relevantFacts(failing, 'cycle route to work', FACTS, [])).map((f) => f.id),
    ['f1'],
  );
  assertEquals(keywordFacts('nothing in common here', FACTS), []);
});

Deno.test('the extra facts are added after the core profile', () => {
  const text = withRelevant('What you know about the person:\n- Lives in Dublin', [FACTS[1]!]);
  assertStringIncludes(text, '- Lives in Dublin\nAlso likely relevant here');
  assertStringIncludes(text, '- Allergic to cats');
  assertEquals(withRelevant('core', []), 'core');
});
