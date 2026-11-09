import { expect, test } from '@playwright/test';

// Task 11.U1: the app shell. Phone: bottom tab bar (plus Calendar and Settings
// in the top bar). iPad and desktop: sidebar. Dark mode reaches the shell.

const TABS = ['Capture', 'Today', 'Inbox', 'Library', 'Insights'];

test.describe('phone (390 x 844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the tab bar navigates between the five tabs', async ({ page }) => {
    await page.goto('/');
    const tabs = page.getByRole('navigation', { name: 'Tabs' });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sidebar' })).toHaveCount(0);
    for (const name of TABS) {
      await tabs.getByRole('link', { name }).click();
      await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    }
    // The tab bar sits at the bottom of the screen and every tab is at least 44 px tall.
    const box = await tabs.boundingBox();
    expect(box && box.y + box.height).toBeGreaterThan(800);
    for (const name of TABS) {
      const tab = await tabs.getByRole('link', { name }).boundingBox();
      expect(tab?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // Calendar and Settings stay in the top bar.
    await page.getByRole('link', { name: 'Calendar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  test('the large title moves into the top bar once scrolled away', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByTestId('compact-title')).toHaveCount(0);
    await page.getByRole('main').evaluate((el) => el.scrollTo(0, 600));
    await expect(page.getByTestId('compact-title')).toHaveText('Settings');
    await page.getByRole('main').evaluate((el) => el.scrollTo(0, 0));
    await expect(page.getByTestId('compact-title')).toHaveCount(0);
  });
});

test.describe('desktop (1440 x 900)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the sidebar navigates, in the same order, with Settings last', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0);
    await expect(sidebar.getByRole('link')).toHaveText([
      'Capture',
      'Today',
      'Calendar',
      'Inbox',
      'Library',
      'Insights',
      'Settings',
    ]);
    for (const name of ['Today', 'Inbox', 'Library', 'Insights', 'Settings', 'Capture']) {
      await sidebar.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(sidebar.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    }
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

  test('the shell and pages use the dark tokens', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(canvas).toBe('rgb(0, 0, 0)');
    const heading = await page
      .getByRole('heading', { level: 1, name: 'Settings' })
      .evaluate((el) => getComputedStyle(el).color);
    expect(heading).toBe('rgb(242, 242, 247)');
  });
});
