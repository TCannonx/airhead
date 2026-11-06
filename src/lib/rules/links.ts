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
