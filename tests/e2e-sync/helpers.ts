import { expect, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

interface MailpitSearch {
  messages_count?: number;
  messages: { ID: string }[];
}

async function messagesFor(email: string): Promise<MailpitSearch> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  if (!res.ok) throw new Error(`mailpit search ${res.status}`);
  return (await res.json()) as MailpitSearch;
}

/** Waits for a new sign-in email (newer than `before` messages) and returns its 6-digit code. */
export async function readCode(email: string, before: number): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const found = await messagesFor(email);
    if (found.messages.length > before) {
      const id = found.messages[0]?.ID; // newest first
      const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
      const body = (await res.json()) as { Text?: string; HTML?: string };
      const match = `${body.Text ?? ''} ${body.HTML ?? ''}`.match(/\b(\d{6})\b/);
      if (match?.[1]) return match[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no sign-in email for ${email}`);
}

/** Signs in through the real UI with an emailed code. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  const before = (await messagesFor(email)).messages.length;
  const codeBox = page.getByLabel(/6-digit code/i);
  // Supabase Auth makes a second code request for the same email wait a few
  // seconds; the app shows "Wait N seconds" and the user (or this test) retries.
  for (let attempt = 0; ; attempt++) {
    await page.getByRole('button', { name: /email me a code/i }).click();
    const alert = page.getByRole('alert');
    await expect(codeBox.or(alert)).toBeVisible({ timeout: 15_000 });
    if (await codeBox.isVisible()) break;
    const text = (await alert.textContent()) ?? '';
    const seconds = Number(text.match(/Wait (\d+) seconds/)?.[1] ?? 0);
    if (!seconds || attempt >= 3) throw new Error(`sign-in email failed: ${text}`);
    await page.waitForTimeout((seconds + 1) * 1000);
  }
  await codeBox.fill(await readCode(email, before));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible();
}
