import { expect, test } from '@playwright/test';

test('shell still loads offline after the service worker installs', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Capture', level: 1 })).toBeVisible();

  // Wait until the service worker is active, then reload so it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Capture', level: 1 })).toBeVisible();

  // A deep link must also fall back to the cached app shell (SPA navigation).
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await context.setOffline(false);
});

test('web app manifest is installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  if (!href) throw new Error('no <link rel="manifest">');
  const res = await request.get(href);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe('Airhead');
  expect(manifest.short_name).toBe('Airhead');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
});

test('has the iOS home-screen tags', async ({ page, request }) => {
  await page.goto('/');
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  if (!touch) throw new Error('no <link rel="apple-touch-icon">');
  expect((await request.get(touch)).ok()).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Airhead',
  );
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', /#/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover/,
  );
});
