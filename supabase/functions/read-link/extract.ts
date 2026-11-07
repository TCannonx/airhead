import { Readability } from 'npm:@mozilla/readability@0.6.0';
import { DOMParser } from 'npm:linkedom@0.18.15';

export const MAX_WORDS = 3_000;
/** Below this the page is a teaser, a login wall or an app shell: "couldn't read". */
export const MIN_READABLE_WORDS = 120;
const WORDS_PER_MINUTE = 230;
const PAYWALL =
  /subscribe to (continue|read)|already a subscriber|sign in to (continue|read)|log in to (continue|read)/i;

export interface LinkInfo {
  /** read = article text kept for one summary; title_only = video/app pages; unreadable = couldn't read. */
  status: 'read' | 'title_only' | 'unreadable';
  title: string | null;
  description: string | null;
  word_count: number;
  reading_minutes: number | null;
  /** Up to 3,000 words; stored on the capture only until the next sort batch summarises it. */
  text: string | null;
}

/** The slice of the DOM used here (Deno has no browser DOM types; linkedom provides it). */
interface HtmlDoc {
  querySelector(selector: string): {
    getAttribute(name: string): string | null;
    textContent: string | null;
  } | null;
}

function meta(doc: HtmlDoc) {
  const content = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const docTitle = doc.querySelector('title')?.textContent?.trim() || null;
  const h1 = doc.querySelector('h1')?.textContent?.trim() || null;
  return {
    // og:title, else the page's own headline when <title> is "Headline | Site", else <title>.
    title:
      content('meta[property="og:title"]') ||
      (h1 && docTitle?.startsWith(h1) ? h1 : null) ||
      docTitle,
    description: content('meta[property="og:description"]') || content('meta[name="description"]'),
  };
}

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html') as unknown as HtmlDoc;

export function extractArticle(html: string, _url: string): LinkInfo {
  const m = meta(parse(html));
  let article: {
    title?: string | null;
    textContent?: string | null;
    excerpt?: string | null;
  } | null = null;
  try {
    // Readability changes the document it reads, so give it its own copy.
    article = new Readability(
      parse(html) as unknown as ConstructorParameters<typeof Readability>[0],
    ).parse();
  } catch {
    article = null;
  }
  const words = (article?.textContent ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const readable =
    words.length >= MIN_READABLE_WORDS && !(PAYWALL.test(html) && words.length < 400);
  const title = m.title || article?.title?.trim() || null;
  const description = m.description || article?.excerpt?.trim() || null;
  if (!readable) {
    return {
      status: 'unreadable',
      title,
      description,
      word_count: 0,
      reading_minutes: null,
      text: null,
    };
  }
  return {
    status: 'read',
    title,
    description,
    word_count: words.length,
    reading_minutes: Math.max(1, Math.round(words.length / WORDS_PER_MINUTE)),
    text: words.slice(0, MAX_WORDS).join(' '),
  };
}

const TITLE_ONLY_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;

/** What to store for a link, given the fetch outcome. */
export function linkInfoFor(url: string, fetched: { status: string; html?: string }): LinkInfo {
  if (fetched.status !== 'ok' || !fetched.html) {
    return {
      status: 'unreadable',
      title: null,
      description: null,
      word_count: 0,
      reading_minutes: null,
      text: null,
    };
  }
  if (TITLE_ONLY_HOSTS.test(new URL(url).hostname)) {
    const m = meta(parse(fetched.html));
    return { status: 'title_only', ...m, word_count: 0, reading_minutes: null, text: null };
  }
  return extractArticle(fetched.html, url);
}
