import { expect, test } from '@playwright/test';

test('app loads on the Capture screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Capture', level: 1 })).toBeVisible();
});
