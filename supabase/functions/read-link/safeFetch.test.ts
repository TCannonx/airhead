import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { isPrivateAddress, safeFetch } from './safeFetch.ts';

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });

/** Fake network: url → response; hostname → IPs. */
function net(routes: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const fetched: string[] = [];
  return {
    fetched,
    deps: {
      fetch: (url: string) => {
        fetched.push(url);
        const r = routes[url];
        return Promise.resolve(r ? r() : new Response('not found', { status: 404 }));
      },
      resolve: (host: string) => Promise.resolve(dns[host] ?? ['93.184.216.34']),
    },
  };
}

Deno.test('private and local addresses are recognised', () => {
  for (const ip of [
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
  ]) {
    assertEquals(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
    assertEquals(isPrivateAddress(ip), false, ip);
  }
});

Deno.test('fetches a normal public page', async () => {
  const { deps } = net({ 'https://example.com/a': () => html('<p>hi</p>') });
  const r = await safeFetch('https://example.com/a', deps);
  assertEquals(r.status, 'ok');
  if (r.status === 'ok') assertEquals(r.html, '<p>hi</p>');
});

Deno.test('rejects non-http(s) schemes', async () => {
  for (const url of [
    'file:///etc/passwd',
    'ftp://example.com/x',
    'javascript:alert(1)',
    'data:text/html,hi',
  ]) {
    const { deps, fetched } = net({});
    assertEquals((await safeFetch(url, deps)).status, 'blocked', url);
    assertEquals(fetched.length, 0);
  }
});

Deno.test('rejects private IP literals and hostnames that resolve to private IPs', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://localhost/',
  ]) {
    const { deps, fetched } = net({});
    assertEquals((await safeFetch(url, deps)).status, 'blocked', url);
    assertEquals(fetched.length, 0, url);
  }
  const { deps, fetched } = net({}, { 'internal.example.com': ['10.1.2.3'] });
  assertEquals((await safeFetch('https://internal.example.com/', deps)).status, 'blocked');
  assertEquals(fetched.length, 0);
});

Deno.test('follows up to 3 redirects, checking every hop', async () => {
  const redirect = (to: string) => () =>
    new Response(null, { status: 302, headers: { location: to } });
  const ok = net({
    'https://a.example/1': redirect('https://a.example/2'),
    'https://a.example/2': redirect('/3'),
    'https://a.example/3': () => html('<p>done</p>'),
  });
  const r = await safeFetch('https://a.example/1', ok.deps);
  assertEquals(r.status, 'ok');
  if (r.status === 'ok') assertEquals(r.finalUrl, 'https://a.example/3');

  const tooMany = net({
    'https://b.example/1': redirect('https://b.example/2'),
    'https://b.example/2': redirect('https://b.example/3'),
    'https://b.example/3': redirect('https://b.example/4'),
    'https://b.example/4': redirect('https://b.example/5'),
    'https://b.example/5': () => html('x'),
  });
  assertEquals((await safeFetch('https://b.example/1', tooMany.deps)).status, 'error');

  const toPrivate = net({ 'https://c.example/': redirect('http://192.168.0.10/admin') }, {});
  assertEquals((await safeFetch('https://c.example/', toPrivate.deps)).status, 'blocked');
  assertEquals(toPrivate.fetched, ['https://c.example/']);
});

Deno.test('stops reading past 2 MB', async () => {
  const big = 'x'.repeat(2 * 1024 * 1024 + 10);
  const { deps } = net({ 'https://big.example/': () => html(big) });
  assertEquals((await safeFetch('https://big.example/', deps)).status, 'too_large');
});

Deno.test('non-HTML responses are not read', async () => {
  const { deps } = net({
    'https://x.example/file.pdf': () =>
      new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }),
  });
  assertEquals((await safeFetch('https://x.example/file.pdf', deps)).status, 'not_html');
});

Deno.test('HTTP errors are reported, not thrown', async () => {
  const { deps } = net({ 'https://x.example/403': () => new Response('no', { status: 403 }) });
  const r = await safeFetch('https://x.example/403', deps);
  assertEquals(r.status, 'error');
});
