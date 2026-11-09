import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Shared checks for the page-by-page UI tests (Tasks 11.U3, 11.U4).

export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };
export const DESKTOP = { viewport: { width: 1440, height: 900 } };
export const SIZES = [
  ['phone', PHONE],
  ['desktop', DESKTOP],
] as const;

/** Opens a page and checks the basics every page must meet. */
export async function open(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await noSidewaysScroll(page, path);
}

export async function noSidewaysScroll(page: Page, what: string) {
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(sideways, `${what} scrolls sideways`).toBe(false);
}

/** axe (WCAG 2 A and AA) over the page's main content (or another selector). */
export async function axe(page: Page, include = 'main') {
  const result = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const problems = result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(problems).toEqual([]);
}

/**
 * On a touch screen every visible button (in main, or `scope`) is at least 44 px tall.
 * Switches are left out: their whole 44 px row (label included) is the target.
 */
export async function touchTargets(page: Page, scope = 'main') {
  const small = await page
    .locator(scope)
    .locator('button:visible')
    .evaluateAll((buttons) =>
      buttons
        .filter((b) => b.getAttribute('role') !== 'switch')
        .filter((b) => b.getBoundingClientRect().height < 43.5)
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    );
  expect(small, 'buttons under 44 px').toEqual([]);
}

/** Saves a capture from the Capture page and waits for it in Recent. */
export async function capture(page: Page, text: string) {
  await page.goto('/capture');
  await page.getByLabel('Capture', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recent captures' })).toContainText(text);
}

/** Captures a text and sorts it by hand as the given type. */
export async function captureAs(page: Page, text: string, type: string) {
  await capture(page, text);
  await page.goto('/inbox');
  await page
    .getByRole('list', { name: 'Unsorted' })
    .getByRole('button', { name: `Sort as ${type}` })
    .click();
  await expect(page.getByText('Nothing waiting. Everything is sorted.')).toBeVisible();
}

/** The dark-mode check: black canvas, and `locator`'s surface is the dark surface. */
export async function darkSurfaces(page: Page, surface: string) {
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(0, 0, 0)',
  );
  const bg = await page
    .locator(surface)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(28, 28, 30)');
}
