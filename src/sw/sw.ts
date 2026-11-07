/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { parsePush } from './payload';

declare const self: ServiceWorkerGlobalScope;

// Precache the built app shell (list injected at build time by vite-plugin-pwa).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Single-page app: every navigation is answered with the cached index.html,
// so deep links like /today open offline too.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// New versions take over straight away: Airhead keeps its data in IndexedDB,
// so swapping the shell is safe.
self.skipWaiting();
clientsClaim();

// Push notifications (Task 4.11): show what the server sent; a tap opens the
// linked screen in an open Airhead window, or a new one.
self.addEventListener('push', (event) => {
  const n = parsePush(event.data?.text());
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      ...(n.tag ? { tag: n.tag } : {}),
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: n.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string } | null)?.url ?? '/today',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.navigate(url).catch(() => null);
        await open.focus();
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
