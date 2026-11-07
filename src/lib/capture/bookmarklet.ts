/**
 * "Send to Airhead" bookmarklet (Task 7.4). It runs on the page being read, so
 * it carries no token and posts nothing itself: it only opens Airhead's own
 * /share page in a small window with the page's address, title and any
 * selected text, and the signed-in app saves the capture there.
 */
export const MAX_SELECTION = 4000;

export function shareUrl(
  origin: string,
  page: { url: string; title: string; selection: string },
): string {
  const q = new URLSearchParams({
    url: page.url,
    title: page.title,
    text: page.selection.slice(0, MAX_SELECTION),
  });
  return `${origin.replace(/\/+$/, '')}/share?${q.toString()}`;
}

/** The `javascript:` link to drag to the bookmarks bar. */
export function bookmarkletHref(origin: string): string {
  const target = JSON.stringify(`${origin.replace(/\/+$/, '')}/share?`);
  const code =
    `(()=>{const q=new URLSearchParams({url:location.href,title:document.title,` +
    `text:String(getSelection()||'').slice(0,${MAX_SELECTION})});` +
    `window.open(${target}+q.toString(),'airhead','width=420,height=320')})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

/** The capture text for a shared page: the selection (quoted) or else the title. */
export function sharedText(p: { title?: string | null; text?: string | null }): string {
  const sel = (p.text ?? '').trim();
  const title = (p.title ?? '').trim();
  if (sel && title) return `${title}\n“${sel}”`;
  return sel || title;
}
