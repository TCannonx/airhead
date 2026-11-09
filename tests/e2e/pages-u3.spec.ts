import { expect, test } from '@playwright/test';
import {
  axe,
  capture,
  captureAs,
  darkSurfaces,
  open,
  PHONE,
  SIZES,
  touchTargets,
} from './pageChecks';

// Task 11.U3: Library (item page, lists, trash, search), Insights, notes and
// the ink toolbar, the Workshop, Work and leave (form in the shared Sheet).
// Each at phone and desktop width: renders, main action works, axe WCAG A/AA,
// 44 px buttons on the phone, nothing scrolls sideways.

test.use({ timezoneId: 'Europe/Dublin' });

for (const [name, size] of SIZES) {
  test.describe(`11.U3 pages (${name})`, () => {
    test.use(size);

    test('Library filters, searches and opens an item to edit', async ({ page }) => {
      await captureAs(page, 'Garden shed', 'Idea');
      await open(page, '/library', 'Library');
      const items = page.getByRole('list', { name: 'Items' });
      await expect(items).toContainText('Garden shed');
      await page.getByRole('button', { name: 'Ideas' }).click();
      await expect(page.getByRole('button', { name: 'Ideas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await axe(page);
      if (name === 'phone') await touchTargets(page);

      await page.getByRole('searchbox', { name: 'Search' }).fill('shed');
      await expect(page.getByRole('list', { name: 'Search results' })).toContainText('Garden shed');
      await page.getByRole('searchbox', { name: 'Search' }).fill('');

      await items.getByRole('link', { name: /Garden shed/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Garden shed' })).toBeVisible();
      await axe(page);
      if (name === 'phone') await touchTargets(page);
      await page.getByLabel('Title').fill('Garden shed plans');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Garden shed plans' }),
      ).toBeVisible();
    });

    test('Trash restores a deleted item', async ({ page }) => {
      await captureAs(page, 'Old receipt', 'Note');
      await page.goto('/library');
      await page
        .getByRole('list', { name: 'Items' })
        .getByRole('link', { name: /Old receipt/ })
        .click();
      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
      await page.getByRole('link', { name: 'Trash' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
      const trash = page.getByRole('list', { name: 'Trash' });
      await expect(trash).toContainText('Old receipt');
      await axe(page);
      if (name === 'phone') await touchTargets(page);
      await trash.getByRole('button', { name: 'Restore' }).click();
      await expect(page.getByText('The Trash is empty.')).toBeVisible();
    });

    test('Lists adds and ticks off an entry', async ({ page }) => {
      await open(page, '/library/lists', 'Lists');
      await expect(page.getByRole('heading', { level: 2, name: 'Shopping' })).toBeVisible();
      await page.getByLabel('Add to Shopping').fill('Milk');
      await page.getByLabel('Add to Shopping').press('Enter');
      const milk = page
        .getByRole('list', { name: 'Shopping entries' })
        .getByRole('checkbox', { name: 'Milk' });
      await milk.click();
      await expect(milk).toBeChecked();
      await axe(page);
      if (name === 'phone') await touchTargets(page);
    });

    test('Insights renders its sections', async ({ page }) => {
      await open(page, '/insights', 'Insights');
      await expect(page.getByRole('region', { name: 'Success measures' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'AI usage' })).toBeVisible();
      await axe(page);
      if (name === 'phone') await touchTargets(page);
    });

    test('a typed note opens on the note surface and keeps its text', async ({ page }) => {
      await page.goto('/library');
      await page.getByRole('button', { name: 'New note' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Note' })).toBeVisible();
      const editor = page.getByLabel('Note', { exact: true });
      await editor.click();
      await page.keyboard.type('Buy a new kettle');
      await expect(page.locator('.ah-note')).toContainText('Buy a new kettle');
      await axe(page);
      if (name === 'phone') await touchTargets(page);
    });

    test('the ink toolbar answers and every tool is a 44 px target on the phone', async ({
      page,
    }) => {
      await page.goto('/library');
      await page.getByRole('button', { name: 'New handwritten note' }).click();
      const tools = page.getByRole('toolbar', { name: 'Pen tools' });
      await expect(tools).toBeVisible();
      await tools.getByRole('button', { name: 'Eraser' }).click();
      await expect(tools.getByRole('button', { name: 'Eraser' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await axe(page, '[role="toolbar"]');
      if (name === 'phone') await touchTargets(page, '[role="toolbar"]');
    });

    test('the Workshop page opens from the Inbox', async ({ page }) => {
      await capture(page, 'A reading nook');
      await page
        .getByRole('list', { name: 'Recent captures' })
        .getByRole('button', { name: 'Send to Workshop' })
        .click();
      await page.goto('/inbox');
      await page
        .getByRole('list', { name: 'To flesh out' })
        .getByRole('link', { name: /reading nook/i })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: /reading nook/i })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open the original' })).toBeVisible();
      await axe(page);
      if (name === 'phone') await touchTargets(page);
    });

    test('Work and leave books leave in the shared sheet', async ({ page }) => {
      await open(page, '/work', 'Work and leave');
      await expect(page.getByLabel('Leave balance')).toContainText('days left');
      await axe(page);
      if (name === 'phone') await touchTargets(page);
      await page.getByRole('button', { name: 'Book leave' }).click();
      const sheet = page.getByRole('dialog', { name: 'Book leave' });
      await expect(sheet).toBeVisible();
      await axe(page, '[role="dialog"]');
      if (name === 'phone') await touchTargets(page, '[role="dialog"]');
      const form = sheet.getByRole('form', { name: 'Book leave' });
      await form.getByLabel('From').fill('2026-12-21');
      await form.getByLabel('To').fill('2026-12-22');
      await form.getByRole('button', { name: 'Book leave' }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole('list', { name: /leave year/ }).first()).toContainText('21 Dec');
    });
  });
}

test.describe('11.U3 pages in dark mode', () => {
  test.use({ ...PHONE, colorScheme: 'dark' });

  test('Library, Insights and Work sit on dark surfaces', async ({ page }) => {
    await captureAs(page, 'Dark check', 'Idea');
    await open(page, '/library', 'Library');
    await darkSurfaces(page, '[aria-label="Items"]');
    await axe(page);
    await open(page, '/insights', 'Insights');
    await darkSurfaces(page, 'main .rounded-card');
    await axe(page);
    await open(page, '/work', 'Work and leave');
    await darkSurfaces(page, 'main .rounded-card');
    await axe(page);
  });
});
