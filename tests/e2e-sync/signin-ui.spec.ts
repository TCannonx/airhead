import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers.ts';

// Task 11.U4: the sign-in screen and the signed-in Settings panels (which
// only show their server parts with a server), at phone and desktop width,
// light and dark, with an axe WCAG A/AA check.

async function axe(page: Page, include: string) {
  const result = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);
}

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

for (const [name, viewport, colorScheme] of [
  ['phone light', { width: 390, height: 844 }, 'light'],
  ['phone dark', { width: 390, height: 844 }, 'dark'],
  ['desktop', { width: 1440, height: 900 }, 'light'],
] as const) {
  test.describe(`sign-in and Settings (${name})`, () => {
    test.use({ viewport, colorScheme });

    test('the sign-in screen is calm, labelled and switches to create an account', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Airhead' })).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      const go = page.getByRole('button', { name: 'Continue' });
      expect((await go.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await sideways(page)).toBe(false);
      await axe(page, 'main');
      await page.getByRole('button', { name: 'New here? Create an account' }).click();
      await expect(page.getByLabel('Choose a password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    });

    test('signed-in Settings panels pass axe', async ({ page }) => {
      await signIn(page, `ui-${name.replace(' ', '-')}-${Date.now()}@example.com`);
      await page.goto('/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      expect(await sideways(page)).toBe(false);
      await axe(page, 'main');
    });
  });
}
