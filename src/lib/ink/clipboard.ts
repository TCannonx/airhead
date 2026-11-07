import { useSyncExternalStore } from 'react';
import type { StoredStroke, TextBox } from './strokes';
import { translateStroke } from './selection';

/**
 * The ink clipboard (Task 9.3): strokes and text boxes as data, kept in the
 * app for this session (never the system clipboard), so a selection can be
 * pasted into the same page or another handwritten note.
 */
export interface InkClip {
  strokes: StoredStroke[];
  texts: TextBox[];
}

let clip: InkClip | null = null;
const listeners = new Set<() => void>();

export function copyInk(next: InkClip): void {
  clip = { strokes: [...next.strokes], texts: next.texts.map((t) => ({ ...t })) };
  for (const l of listeners) l();
}

export function clearInkClipboard(): void {
  clip = null;
  for (const l of listeners) l();
}

export const readInkClipboard = () => clip;

export function useInkClipboard(): InkClip | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => clip,
  );
}

/** What a paste adds: shifted so it doesn't cover the original, text boxes with new ids. */
export const PASTE_OFFSET = 30;
export function pasted(c: InkClip, newId: () => string = () => crypto.randomUUID()): InkClip {
  return {
    strokes: c.strokes.map((s) => translateStroke(s, PASTE_OFFSET, PASTE_OFFSET)),
    texts: c.texts.map((t) => ({
      ...t,
      id: newId(),
      x: t.x + PASTE_OFFSET,
      y: t.y + PASTE_OFFSET,
    })),
  };
}
