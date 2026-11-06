import { expect, test } from '@playwright/test';

test('app loads and shows the Airhead name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Airhead' })).toBeVisible();
});
