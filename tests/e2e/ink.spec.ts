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

test('lasso: a loop around strokes selects them; another tool clears it (Task 9.1)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New handwritten note' }).click();
  await expect(page).toHaveURL(/\/notes\//);
  const canvas = page.getByRole('img', { name: 'Handwritten page' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no page');

  // Draw a short stroke.
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 200 + i * 10, box.y + 200 + i * 5);
  await page.mouse.up();

  // Lasso round it.
  await page.getByRole('button', { name: 'Lasso' }).click();
  const loop = [
    [150, 150],
    [350, 150],
    [350, 300],
    [150, 300],
    [150, 150],
  ];
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  for (const [x, y] of loop)
    await page.mouse.move(box.x + (x ?? 0), box.y + (y ?? 0), { steps: 4 });
  await page.mouse.up();
  await expect(canvas.locator('rect[data-lasso="selection"]')).toHaveCount(1);

  // A loop around nothing selects nothing; switching tools clears.
  await page.getByRole('button', { name: 'Highlighter' }).click();
  await expect(canvas.locator('rect[data-lasso="selection"]')).toHaveCount(0);
});

test('lasso: drag a selection to move it, delete it, undo both (Task 9.2)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New handwritten note' }).click();
  await expect(page).toHaveURL(/\/notes\//);
  const canvas = page.getByRole('img', { name: 'Handwritten page' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no page');
  const saved = canvas.locator('path[data-stroke="saved"]');

  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 200 + i * 10, box.y + 200 + i * 5);
  await page.mouse.up();
  const before = await saved.first().getAttribute('d');

  await page.getByRole('button', { name: 'Lasso' }).click();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  for (const [x, y] of [
    [350, 150],
    [350, 300],
    [150, 300],
    [150, 150],
  ])
    await page.mouse.move(box.x + (x ?? 0), box.y + (y ?? 0), { steps: 4 });
  await page.mouse.up();
  const selection = canvas.locator('rect[data-lasso="selection"]');
  await expect(selection).toHaveCount(1);

  // Drag from inside the box.
  await page.mouse.move(box.x + 230, box.y + 215);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 265, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => saved.first().getAttribute('d')).not.toBe(before);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => saved.first().getAttribute('d')).toBe(before);

  await page.getByRole('button', { name: 'Delete selection' }).click();
  await expect(saved).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(saved).toHaveCount(1);
});
