import { expect, test } from '@playwright/test';

// Typed notes (Task 6.3) in a real browser: create, type with Markdown
// shortcuts, and find the text again after a reload.
test('a typed note keeps its text and formatting after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page).toHaveURL(/\/notes\//);

  const editor = page.getByLabel('Note', { exact: true });
  await editor.click();
  await page.keyboard.type('# Plan for Monday');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- book the room');
  await expect(page.getByRole('heading', { name: 'Plan for Monday', level: 1 })).toBeVisible();

  // Saved after a short pause.
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plan for Monday', level: 1 })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'book the room' })).toBeVisible();
});
