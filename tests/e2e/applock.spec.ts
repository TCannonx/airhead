import { expect, test } from '@playwright/test';

// Exercises the real WebAuthn code against Chrome's virtual platform
// authenticator (stands in for Face ID / Touch ID).
test('app lock: turn on, reload, unlock with the platform authenticator', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: /app lock/i });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Airhead is locked' })).toBeVisible();
  await page.getByRole('button', { name: /unlock/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});
