/**
 * Fetches the newest build and reloads into it. On iPhone a Home Screen app
 * can keep running a cached copy across restarts; this asks the service worker
 * to check now, waits briefly for a new one to take over, then reloads.
 */
export async function loadLatestVersion(
  win: Pick<Window, 'location'> = window,
  sw: ServiceWorkerContainer | undefined = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : undefined,
  waitMs = 10_000,
): Promise<void> {
  try {
    const reg = await sw?.getRegistration();
    if (reg) {
      await reg.update();
      const next = reg.installing ?? reg.waiting;
      if (next && sw) {
        // The worker calls skipWaiting(); wait until it controls the page.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, waitMs);
          sw.addEventListener(
            'controllerchange',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    }
  } catch {
    // Offline or no service worker: a plain reload still helps.
  }
  win.location.reload();
}
