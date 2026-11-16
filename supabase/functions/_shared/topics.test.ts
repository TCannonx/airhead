import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { cosine, matchTopics, normTopic, SIMILAR } from './topics.ts';

const EXISTING = [
  { id: 't1', name: 'Marathon training' },
  { id: 't2', name: 'Kitchen extension' },
  { id: 't3', name: 'Home cooking' },
];

// Fixture vectors standing in for gte-small: close meanings share a direction.
const VECTORS: Record<string, number[]> = {
  'Marathon training': [1, 0, 0],
  'Kitchen extension': [0, 1, 0],
  'Home cooking': [0, 0, 1],
  'Long-distance running': [0.95, 0.1, 0.05],
  'House renovation': [0.5, 0.5, 0.4],
  Gardening: [0.2, 0.2, 0.2],
};
const embed = (t: string) => Promise.resolve(VECTORS[t] ?? null);

Deno.test('exact and normalised names come first', async () => {
  assertEquals(
    (
      await matchTopics(['Marathon training', 'kitchen-extensions', 'Marathon Training'], EXISTING)
    ).map((m) => [m.id, m.how]),
    [
      ['t1', 'exact'],
      ['t2', 'normalised'],
    ],
  );
  assertEquals(normTopic(' Marathon-Trainings '), 'marathon training');
});

Deno.test(
  'then the closest topic by meaning, above the threshold; otherwise a new topic',
  async () => {
    const out = await matchTopics(
      ['Long-distance running', 'House renovation', 'Gardening'],
      EXISTING,
      embed,
    );
    assertEquals(
      out.map((m) => [m.name, m.id, m.how]),
      [
        ['Long-distance running', 't1', 'similar'],
        ['House renovation', null, 'new'],
        ['Gardening', null, 'new'],
      ],
    );
    assertEquals(
      cosine(VECTORS['Long-distance running'] ?? [], VECTORS['Marathon training'] ?? []) >= SIMILAR,
      true,
    );
  },
);

Deno.test('without the embedding model, unknown names are new topics', async () => {
  assertEquals(
    (await matchTopics(['Long-distance running'], EXISTING)).map((m) => m.how),
    ['new'],
  );
  assertEquals(await matchTopics(['  '], EXISTING), []);
});
