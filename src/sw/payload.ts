/** What a push message turns into on screen (Task 4.11). Pure, so it is unit-tested. */
export interface ShownNotification {
  title: string;
  body: string;
  tag?: string;
  /** Always an in-app path ("/today"), never another site. */
  url: string;
}

/** Only same-app paths are opened on tap; anything else opens Today. */
export function safePath(url: unknown): string {
  return typeof url === 'string' && /^\/(?!\/)[\w\-/.?=&%#]*$/.test(url) ? url : '/today';
}

export function parsePush(text: string | null | undefined): ShownNotification {
  const data = ((): Record<string, unknown> => {
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { body: text };
    }
  })();
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    title: str(data.title, 120) || 'Airhead',
    body: str(data.body, 400),
    ...(typeof data.tag === 'string' && data.tag ? { tag: data.tag.slice(0, 64) } : {}),
    url: safePath(data.url),
  };
}
