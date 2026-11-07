import { expect, test } from '@playwright/test';

// Handwritten page (Task 6.5): draw with the mouse (the Pencil on iPad),
// erase, undo, and find the stroke again after a reload.
test('a drawn stroke is saved, can be erased and undone, and survives a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New handwritten note' }).click();
  await expect(page).toHaveURL(/\/notes\//);

  const canvas = page.getByRole('img', { name: 'Handwritten page' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no page');
  const saved = canvas.locator('path[data-stroke="saved"]');

  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 100 + i * 20, box.y + 100 + i * 5);
  await page.mouse.up();
  await expect(saved).toHaveCount(1);

  // Erase it by touching it with the eraser, then undo.
  await page.getByRole('button', { name: 'Eraser' }).click();
  await page.mouse.click(box.x + 200, box.y + 125);
  await expect(saved).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(saved).toHaveCount(1);

  await page.waitForTimeout(1500);
  await page.reload();
  await expect(
    page.getByRole('img', { name: 'Handwritten page' }).locator('path[data-stroke="saved"]'),
  ).toHaveCount(1);
});

test('text boxes: add with the text tool, kept after a reload, deleted', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New handwritten note' }).click();
  await expect(page).toHaveURL(/\/notes\//);
  const canvas = page.getByRole('img', { name: 'Handwritten page' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no page');

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box.x + 150, box.y + 300);
  await page.keyboard.type('Book the room');
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Text box' })).toHaveValue('Book the room');

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Delete text box Book the room' }).click();
  await expect(page.getByRole('textbox', { name: 'Text box' })).toHaveCount(0);
});
