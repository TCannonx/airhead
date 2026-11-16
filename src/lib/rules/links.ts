const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

export interface FoundUrl {
  url: string;
  index: number;
  length: number;
}

/** First http(s) link in the text, without trailing punctuation. */
export function findUrl(text: string): FoundUrl | null {
  const m = URL_IN_TEXT.exec(text);
  if (!m) return null;
  const url = m[0].replace(/[),.;:!?]+$/, '');
  return { url, index: m.index, length: url.length };
}

const URLS_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
/** Query parameters that only track where a link came from (Task 16.1). */
const TRACKING =
  /^(?:utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|si|ref|ref_src|_hsenc|_hsmi|mkt_tok)$/i;

/**
 * The same link however it was shared (Task 16.1): lower-case host, no
 * "www.", no tracking parameters, no fragment, no trailing slash.
 */
export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()])
      if (TRACKING.test(key)) u.searchParams.delete(key);
    const out = u.toString().replace(/\/(\?|$)/, '$1');
    return out.replace(/\?$/, '');
  } catch {
    return url;
  }
}

/** Every distinct http(s) link in the text, in order, trailing punctuation removed (Task 16.1). */
export function findUrls(text: string): FoundUrl[] {
  const out: FoundUrl[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URLS_IN_TEXT)) {
    let url = m[0].replace(/[),.;:!?]+$/, '');
    // A closing bracket that belongs to the sentence, not the link.
    if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1);
    const key = normaliseUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, index: m.index ?? 0, length: url.length });
  }
  return out;
}

/** The words of the text with its links taken out. */
export function withoutUrls(text: string): string {
  return text.replace(URLS_IN_TEXT, ' ').replace(/\s+/g, ' ').trim();
}
