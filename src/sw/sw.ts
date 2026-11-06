/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

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

// Push and notification-click handlers are added in Task 4.11.
