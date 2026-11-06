// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const headers = () => readFileSync(resolve(root, 'public/_headers'), 'utf8');

/** Parses Cloudflare Pages `_headers` into { pattern: { header: value } }. */
function parse(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = rules[line.trim()] = {};
    } else if (current) {
      const i = line.indexOf(':');
      current[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

describe('Cloudflare Pages hosting files', () => {
  it('has no top-level 404.html, so Pages serves the app for every route (SPA mode)', () => {
    expect(existsSync(resolve(root, 'public/404.html'))).toBe(false);
  });

  it('never caches the service worker or the manifest, so updates reach devices', () => {
    const rules = parse(headers());
    expect(rules['/sw.js']?.['Cache-Control']).toBe('no-cache');
    expect(rules['/manifest.webmanifest']?.['Cache-Control']).toBe('no-cache');
  });

  it('sends basic security headers on every page', () => {
    const all = parse(headers())['/*'] ?? {};
    expect(all['X-Content-Type-Options']).toBe('nosniff');
    expect(all['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(all['X-Frame-Options']).toBe('DENY');
  });

  it('keeps within the 100-rule limit', () => {
    expect(Object.keys(parse(headers())).length).toBeLessThanOrEqual(100);
  });
});
