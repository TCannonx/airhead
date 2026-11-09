import { expect, test } from '@playwright/test';

// Task 11.U1: the design kit renders every shared component, and the colour
// tokens follow the system colour scheme.

const SECTIONS = [
  'Colours',
  'Type',
  'Buttons',
  'Chips and badges',
  'Segmented control',
  'Grouped list',
  'Fields',
  'Empty state',
  'Sheet and toast',
];

test('design kit is reachable from Settings and shows both schemes', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('link', { name: /Design kit/ }).click();
  await expect(page).toHaveURL(/\/ui$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
  for (const name of ['Light', 'Dark']) {
    const panel = page.getByRole('region', { name });
    for (const section of SECTIONS) {
      await expect(panel.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
  }
  // The dark panel really is dark, the light one light.
  const bg = (name: string) =>
    page.getByRole('region', { name }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg('Light')).toBe('rgb(242, 242, 247)');
  expect(await bg('Dark')).toBe('rgb(0, 0, 0)');

  // The sheet opens, traps focus and closes on Escape.
  const light = page.getByRole('region', { name: 'Light' });
  await light.getByRole('button', { name: 'Open sheet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Example sheet' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The segmented control answers the keyboard.
  await light.getByRole('radio', { name: 'Week' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(light.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the page canvas follows prefers-color-scheme', async ({ page }) => {
    await page.goto('/ui');
    await expect(page.getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(body).toBe('rgb(0, 0, 0)');
    // A forced-light panel stays light inside a dark page.
    const light = await page
      .getByRole('region', { name: 'Light' })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(light).toBe('rgb(242, 242, 247)');
  });
});

test.describe('light mode', () => {
  test.use({ colorScheme: 'light' });

  test('the page canvas is light', async ({ page }) => {
    await page.goto('/ui');
    await expect(page.getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(body).toBe('rgb(242, 242, 247)');
  });
});
