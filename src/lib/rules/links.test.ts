import { describe, expect, it } from 'vitest';
import { findUrls, normaliseUrl, withoutUrls } from './links';

describe('every link, wherever it is (Task 16.1)', () => {
  it('finds links mid-sentence and several in one note, without trailing punctuation', () => {
    const text =
      'Read this https://example.com/a?x=1, and also (https://news.example.org/b). Then https://example.com/c!';
    expect(findUrls(text).map((f) => f.url)).toEqual([
      'https://example.com/a?x=1',
      'https://news.example.org/b',
      'https://example.com/c',
    ]);
  });

  it('the same link twice, or with tracking parameters, counts once', () => {
    expect(
      findUrls('https://Example.com/a?utm_source=x and https://www.example.com/a/ and https://example.com/a#top').map(
        (f) => f.url,
      ),
    ).toEqual(['https://Example.com/a?utm_source=x']);
    expect(normaliseUrl('https://www.Example.com/post/?utm_medium=e&id=7&fbclid=z#c')).toBe(
      'https://example.com/post?id=7',
    );
  });

  it('ignores schemes other than http(s)', () => {
    expect(findUrls('mailto:a@b.com ftp://files.example.com tel:123')).toEqual([]);
  });

  it('keeps the words around the links', () => {
    expect(withoutUrls('Look at https://a.example/x for the trip  ideas')).toBe('Look at for the trip ideas');
  });
});
