import { expect, type Page } from '@playwright/test';

/** Signs in through the real UI with email and password (the first call creates the account). */
export async function signIn(
  page: Page,
  email: string,
  password = 'e2e password 1234',
): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible({
    timeout: 15_000,
  });
}

/** Captures text on the Capture screen and waits for it in Recent captures. */
export async function capture(page: Page, text: string): Promise<void> {
  await page.getByRole('link', { name: 'Capture' }).first().click();
  const box = page.getByLabel('Capture', { exact: true });
  await box.fill(text);
  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Recent captures' }).getByText(text)).toBeVisible();
}
