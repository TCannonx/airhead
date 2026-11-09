import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Tasks 11.U2–11.U4: every page on the shared components. Each page renders at
// phone and desktop width, its main action works, dark mode reaches its
// surfaces, nothing scrolls sideways, and axe finds no WCAG A/AA problems.

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

test.use({ timezoneId: 'Europe/Dublin' });

/** Opens a page and checks the basics every page must meet. */
async function open(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(sideways, `${path} scrolls sideways`).toBe(false);
}

/** axe (WCAG 2 A and AA) over the page's main content. */
async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const problems = result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(problems).toEqual([]);
}

/** On a touch screen every button in the page is at least 44 px tall. */
async function touchTargets(page: Page) {
  const small = await page
    .getByRole('main')
    .locator('button:visible')
    .evaluateAll((buttons) =>
      buttons
        .filter((b) => b.getBoundingClientRect().height < 43.5)
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    );
  expect(small, 'buttons under 44 px').toEqual([]);
}

async function capture(page: Page, text: string) {
  await page.goto('/capture');
  const box = page.getByLabel('Capture', { exact: true });
  await box.fill(text);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recent captures' })).toContainText(text);
}

for (const [name, size] of [
  ['phone', PHONE],
  ['desktop', DESKTOP],
] as const) {
  test.describe(`11.U2 pages (${name})`, () => {
    test.use(size);

    test('Capture saves a note into Recent', async ({ page }) => {
      await open(page, '/capture', 'Capture');
      await capture(page, 'Ring the plumber');
      await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
      await axe(page);
      if (name === 'phone') await touchTargets(page);
    });

    test('Inbox sorts a capture by hand and shows the empty state', async ({ page }) => {
      await capture(page, 'Buy stamps');
      await open(page, '/inbox', 'Inbox');
      const unsorted = page.getByRole('list', { name: 'Unsorted' });
      await expect(unsorted).toContainText('Buy stamps');
      await axe(page);
      if (name === 'phone') await touchTargets(page);
      await unsorted.getByRole('button', { name: 'Sort as Task' }).click();
      await expect(page.getByText('Nothing waiting. Everything is sorted.')).toBeVisible();
    });

    test('Today shows the Top 3 and ticks a task done', async ({ page }) => {
      await capture(page, 'Post the parcel');
      await page.goto('/inbox');
      await page
        .getByRole('list', { name: 'Unsorted' })
        .getByRole('button', { name: 'Sort as Task' })
        .click();
      // Pin it to today's Top 3 from its item page (the automatic pick depends on the hour).
      await page.goto('/library');
      await page
        .getByRole('list', { name: 'Items' })
        .getByRole('link', { name: /Post the parcel/ })
        .click();
      await page.getByRole('button', { name: 'Add to today’s Top 3' }).click();
      await expect(page.getByRole('button', { name: 'Remove from today’s Top 3' })).toBeVisible();
      await open(page, '/today', 'Today');
      const top = page.getByRole('main').getByRole('list', { name: 'Top 3' });
      const done = top.getByRole('checkbox', { name: 'Done: Post the parcel' });
      await expect(done).toBeVisible();
      await axe(page);
      if (name === 'phone') await touchTargets(page);
      // A pinned task stays in the Top 3, ticked and struck through.
      await done.click(); // controlled: the tick lands once the database answers
      await expect(done).toBeChecked();
      await expect(page.getByRole('link', { name: 'Evening review' })).toBeVisible();
    });

    test('Evening review shows its empty state and goes back to Today', async ({ page }) => {
      await open(page, '/review', 'Evening review');
      await expect(page.getByText('All done for today.')).toBeVisible();
      await axe(page);
      await page.getByRole('main').getByRole('link', { name: 'Back to Today' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    });
  });
}

test.describe('11.U2 pages in dark mode', () => {
  test.use({ ...PHONE, colorScheme: 'dark' });

  test('lists sit on the dark surface over a black canvas', async ({ page }) => {
    await capture(page, 'Dark mode check');
    for (const [path, title, list] of [
      ['/capture', 'Capture', 'Recent captures'],
      ['/inbox', 'Inbox', 'Unsorted'],
    ] as const) {
      await open(page, path, title);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        'rgb(0, 0, 0)',
      );
      const bg = await page
        .getByRole('list', { name: list })
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe('rgb(28, 28, 30)');
      await axe(page);
    }
  });
});
