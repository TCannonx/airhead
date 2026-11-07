/**
 * Fetches a web page safely for link reading (and, later, linked calendars):
 * http/https only, every hop's host resolved and rejected if private or local,
 * at most 3 redirects, 10 s timeout, 2 MB cap. Never throws for network issues.
 */
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const TIMEOUT_MS = 10_000;

export type SafeFetchResult =
  | { status: 'ok'; html: string; finalUrl: string; contentType: string }
  | { status: 'blocked' | 'error' | 'too_large' | 'not_html'; reason: string };

/** What a caller accepts: link reading wants HTML; linked calendars want iCalendar. */
export interface SafeFetchOptions {
  accept: string;
  allowType: RegExp;
  maxBytes: number;
  userAgent: string;
}
export const HTML_OPTIONS: SafeFetchOptions = {
  accept: 'text/html,application/xhtml+xml',
  allowType: /text\/html|application\/xhtml\+xml/i,
  maxBytes: MAX_BYTES,
  userAgent: 'Airhead link reader',
};
/** Calendar servers label .ics files loosely; the caller checks for BEGIN:VCALENDAR. */
export const ICS_OPTIONS: SafeFetchOptions = {
  accept: 'text/calendar,text/plain;q=0.8,*/*;q=0.5',
  allowType:
    /text\/calendar|text\/plain|application\/(?:octet-stream|ics|x-ical|calendar)|text\/x-vcalendar|^$/i,
  maxBytes: 5 * 1024 * 1024,
  userAgent: 'Airhead calendar reader',
};

export interface SafeFetchDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Returns the IPv4/IPv6 addresses for a hostname. */
  resolve: (hostname: string) => Promise<string[]>;
}

function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

export function isPrivateAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ipv4Private(ip);
  if (!ip.includes(':')) return false;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return ipv4Private(mapped[1]);
  if (ip === '::' || ip === '::1') return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 // multicast
  );
}

const isIpLiteral = (host: string) => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');

async function hostAllowed(url: URL, resolve: SafeFetchDeps['resolve']): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }
  if (isIpLiteral(host)) return !isPrivateAddress(host);
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return false;
  }
  return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
}

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function safeFetch(
  input: string,
  deps: SafeFetchDeps,
  options: SafeFetchOptions = HTML_OPTIONS,
): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { status: 'blocked', reason: 'not a valid address' };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await hostAllowed(url, deps.resolve))) {
      return { status: 'blocked', reason: 'address not allowed' };
    }
    let res: Response;
    try {
      res = await deps.fetch(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': options.userAgent, accept: options.accept },
      });
    } catch {
      return { status: 'error', reason: 'could not connect' };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) return { status: 'error', reason: 'redirect without a location' };
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { status: 'error', reason: `HTTP ${res.status}` };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!options.allowType.test(contentType.split(';')[0]?.trim() ?? '')) {
      await res.body?.cancel();
      return { status: 'not_html', reason: contentType || 'unknown type' };
    }
    const html = await readCapped(res, options.maxBytes);
    if (html === null) {
      return { status: 'too_large', reason: `over ${Math.round(options.maxBytes / 1048576)} MB` };
    }
    return { status: 'ok', html, finalUrl: url.toString(), contentType };
  }
  return { status: 'error', reason: 'too many redirects' };
}
