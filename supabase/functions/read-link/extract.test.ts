import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { extractArticle, linkInfoFor, MAX_WORDS } from './extract.ts';

const fixture = (name: string) =>
  Deno.readTextFileSync(new URL(`../../../tests/fixtures/html/${name}`, import.meta.url));

Deno.test('an article is read: title, description, words, reading time, trimmed text', () => {
  const info = extractArticle(fixture('article.html'), 'https://garden.example/compost');
  assertEquals(info.status, 'read');
  assertEquals(info.title, 'How to start composting at home');
  assertEquals(info.description, "A practical beginner's guide to home composting.");
  assert(info.word_count > 300, `words: ${info.word_count}`);
  assert(info.reading_minutes !== null && info.reading_minutes >= 1);
  assert(info.text?.includes('wrung-out sponge'));
  // Navigation and footers are not part of the text.
  assert(!info.text?.includes('Newsletter'));
});

Deno.test('a paywalled page falls back to title and description, marked couldn’t read', () => {
  const info = extractArticle(fixture('paywalled.html'), 'https://ledger.example/housing');
  assertEquals(info.status, 'unreadable');
  assertEquals(info.title, 'Exclusive: the housing market in 2027');
  assertEquals(info.description, 'What buyers can expect next year.');
  assertEquals(info.text, null);
  assertEquals(info.reading_minutes, null);
});

Deno.test('an event page is read (the next batch can suggest the event)', () => {
  const info = extractArticle(fixture('event.html'), 'https://marathon.example/expo');
  assertEquals(info.status, 'read');
  assertEquals(info.title, 'Dublin Marathon Expo 2027');
  assert(info.text?.includes('22 October 2027'));
});

Deno.test('text is capped at 3,000 words', () => {
  const huge =
    `<html><head><title>Long</title></head><body><article><h1>Long</h1>${'<p>' + 'word '.repeat(400) + '</p>'.repeat(1)}`.repeat(
      1,
    ) +
    '<p>' +
    'more '.repeat(5000) +
    '</p></article></body></html>';
  const info = extractArticle(huge, 'https://long.example/');
  assertEquals(info.status, 'read');
  assertEquals(info.text?.split(' ').length, MAX_WORDS);
  assert(info.word_count > MAX_WORDS);
});

Deno.test('YouTube links use the title and description only', () => {
  const page =
    '<html><head><title>My video - YouTube</title><meta name="description" content="A cat."></head><body></body></html>';
  const info = linkInfoFor('https://www.youtube.com/watch?v=abc', { status: 'ok', html: page });
  assertEquals(info.status, 'title_only');
  assertEquals(info.title, 'My video - YouTube');
  assertEquals(info.description, 'A cat.');
});

Deno.test('a page that could not be fetched is couldn’t read, with no title', () => {
  const info = linkInfoFor('https://x.example/', { status: 'blocked' });
  assertEquals(info, {
    status: 'unreadable',
    title: null,
    description: null,
    word_count: 0,
    reading_minutes: null,
    text: null,
  });
});
