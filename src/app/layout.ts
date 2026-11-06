import { useSyncExternalStore } from 'react';

export type Layout = 'phone' | 'tablet' | 'desktop';

/** Phone < 768 px; iPad 768-1279 px; desktop >= 1280 px (matches Tailwind md / xl). */
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1280;

export function layoutFor(width: number): Layout {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'phone';
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

export function useLayout(): Layout {
  return useSyncExternalStore(
    subscribe,
    () => layoutFor(window.innerWidth),
    () => 'phone',
  );
}
