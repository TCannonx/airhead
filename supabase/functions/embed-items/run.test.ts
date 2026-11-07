import { assertEquals } from 'jsr:@std/assert@1.0.19';
import {
  CHUNK_WORDS,
  chunkText,
  runEmbed,
  type EmbedDeps,
  type ItemText,
  type NewChunk,
} from './run.ts';
import { htmlText, itemParts } from './text.ts';

const USER = '11111111-1111-4111-8111-111111111111';

function fake(items: Record<string, ItemText | null>, queue: string[]) {
  const store = new Map<string, NewChunk>();
  const embedded: string[] = [];
  const d: EmbedDeps = {
    take: (n) => Promise.resolve(queue.splice(0, n).map((item_id) => ({ item_id, user_id: USER }))),
    load: (id) => Promise.resolve(items[id] ?? null),
    existing: (id) =>
      Promise.resolve(
        [...store.values()]
          .filter((c) => c.item_id === id)
          .map((c) => ({ chunk_index: c.chunk_index, content_hash: c.content_hash })),
      ),
    upsert: (chunks) => {
      for (const c of chunks) store.set(`${c.item_id}:${c.chunk_index}`, c);
      return Promise.resolve();
    },
    removeFrom: (id, from) => {
      for (const [k, c] of store) if (c.item_id === id && c.chunk_index >= from) store.delete(k);
      return Promise.resolve();
    },
    embed: (text) => {
      embedded.push(text);
      return Promise.resolve(Array.from({ length: 384 }, () => 0.05));
    },
  };
  return { d, store, embedded };
}

const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

Deno.test('chunks are about 300 words, overlap, and each starts with the title', () => {
  const chunks = chunkText('Garden shed', [words(700)]);
  assertEquals(chunks.length, 3);
  for (const c of chunks) assertEquals(c.startsWith('Garden shed\n'), true);
  assertEquals(chunks[0]?.split(/\s+/).length, CHUNK_WORDS + 2);
  assertEquals(chunks[1]?.includes('word260'), true);
  assertEquals(chunkText('Only a title', []), ['Only a title']);
  assertEquals(chunkText('', []), []);
});

Deno.test('only changed chunks are embedded; a shorter text drops the extra chunks', async () => {
  const item: ItemText = {
    id: 'i1',
    user_id: USER,
    title: 'Shed',
    deleted: false,
    parts: [words(500)],
  };
  const items: Record<string, ItemText | null> = { i1: item };
  const queue = ['i1'];
  const { d, store, embedded } = fake(items, queue);
  assertEquals(await runEmbed(d), { items: 1, embedded: 2, skipped: 0, removed: 0, facts: 0 });

  queue.push('i1');
  assertEquals((await runEmbed(d)).skipped, 2);
  assertEquals(embedded.length, 2);

  items.i1 = { ...item, parts: [words(100, 'new')] };
  queue.push('i1');
  assertEquals(await runEmbed(d), { items: 1, embedded: 1, skipped: 0, removed: 1, facts: 0 });
  assertEquals([...store.keys()], ['i1:0']);
  assertEquals(store.get('i1:0')?.content.includes('new5'), true);
});

Deno.test('deleted or missing items lose their chunks', async () => {
  const items: Record<string, ItemText | null> = {
    i1: { id: 'i1', user_id: USER, title: 'Shed', deleted: false, parts: ['bikes'] },
  };
  const queue = ['i1'];
  const { d, store } = fake(items, queue);
  await runEmbed(d);
  assertEquals(store.size, 1);
  items.i1 = { ...items.i1!, deleted: true };
  queue.push('i1', 'gone');
  assertEquals((await runEmbed(d)).removed, 2);
  assertEquals(store.size, 0);
});

Deno.test('item text covers notes, summaries, transcriptions and drafts', () => {
  assertEquals(htmlText('<h1>Plan</h1><p>Buy &amp; fit</p>'), 'Plan\nBuy & fit');
  const parts = itemParts({
    body: 'body text',
    data: {
      summary: {
        summary: 'Travel cut',
        decisions: ['Cut travel'],
        transcription: 'handwritten words',
        actions: [{ title: 'Send figures' }],
      },
    },
    noteDoc: { kind: 'typed', doc: { html: '<p>typed words</p>' } },
    draft: {
      summary: 'draft summary',
      sections: [{ heading: 'Costs', body: 'About €500' }],
      next_steps: ['Measure'],
    },
  });
  assertEquals(parts, [
    'body text',
    'Travel cut',
    'Cut travel',
    'handwritten words',
    'Send figures',
    'typed words',
    'draft summary',
    'Costs',
    'About €500',
    'Measure',
  ]);
  assertEquals(
    itemParts({
      body: null,
      data: { summary: 'A reading summary', key_points: ['one'] },
      noteDoc: { kind: 'ink', doc: { pages: [{ texts: [{ text: 'box' }] }] } },
      draft: null,
    }),
    ['A reading summary', 'one', 'box'],
  );
});

Deno.test('waiting memory facts are embedded too', async () => {
  const { d, embedded } = fake({}, []);
  const stored: string[] = [];
  d.factsToEmbed = () => Promise.resolve([{ id: 'f1', text: 'Cycles to work' }]);
  d.storeFact = (id, e) => {
    stored.push(`${id}:${e.length}`);
    return Promise.resolve();
  };
  assertEquals((await runEmbed(d)).facts, 1);
  assertEquals(stored, ['f1:384']);
  assertEquals(embedded, ['Cycles to work']);
});
