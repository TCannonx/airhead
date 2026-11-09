import { expect, test } from '@playwright/test';
import {
  axe,
  darkSurfaces,
  noSidewaysScroll,
  open,
  PHONE,
  SIZES,
  touchTargets,
} from './pageChecks.ts';

// Task 11.U4: the Settings panels (Work, Memory and check-up, Today, linked
// calendars, capture tokens, sharing, notifications, Scout, app lock) and the
// Share page, at phone and desktop width. Sign-in needs a server, so it is
// checked in the e2e sync job (tests/e2e-sync/signin-ui.spec.ts).

test.use({ timezoneId: 'Europe/Dublin' });

for (const [name, size] of SIZES) {
  test.describe(`11.U4 pages (${name})`, () => {
    test.use(size);

    test('Settings panels pass axe and save a work setting', async ({ page }) => {
      await open(page, '/settings', 'Settings');
      await expect(page.getByRole('switch', { name: /Scout for ideas/ })).toBeVisible();
      await axe(page);
      if (name === 'phone') await touchTargets(page);

      const save = page.getByRole('button', { name: 'Save work settings' });
      await expect(save).toBeDisabled();
      const sat = page.getByRole('button', { name: 'Sat', exact: true });
      await sat.click();
      await expect(sat).toHaveAttribute('aria-pressed', 'true');
      await save.click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Sat', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    test('a switch in Settings flips and is remembered', async ({ page }) => {
      await open(page, '/settings', 'Settings');
      const scout = page.getByRole('switch', { name: /Scout for ideas/ });
      const before = await scout.getAttribute('aria-checked');
      await scout.click();
      await expect(scout).not.toHaveAttribute('aria-checked', before ?? '');
      await page.reload();
      await expect(page.getByRole('switch', { name: /Scout for ideas/ })).not.toHaveAttribute(
        'aria-checked',
        before ?? '',
      );
    });

    test('the Share page saves what was shared', async ({ page }) => {
      await page.goto('/share?title=Recipe&url=https%3A%2F%2Fexample.com%2Fsoup');
      await expect(page.getByRole('heading', { level: 1, name: 'Send to Airhead' })).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('Saved to Airhead.');
      await noSidewaysScroll(page, '/share');
      await axe(page);
    });
  });
}

test.describe('11.U4 in dark mode', () => {
  test.use({ ...PHONE, colorScheme: 'dark' });

  test('Settings panels sit on dark surfaces and pass axe', async ({ page }) => {
    await open(page, '/settings', 'Settings');
    await darkSurfaces(page, 'main .rounded-card');
    await axe(page);
  });
});
