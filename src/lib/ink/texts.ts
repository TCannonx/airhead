import { PAGE_WIDTH, type TextBox } from './strokes';

/**
 * Text boxes on a handwritten page (Task 6.6): quick typed labels placed with
 * the text tool, kept in the same document as the strokes. Positions are page
 * units, kept inside the page width.
 */
export const TEXT_BOX_WIDTH = 320;

const clampX = (x: number) => Math.max(0, Math.min(PAGE_WIDTH - 40, x));
const clampY = (y: number, height: number) => Math.max(0, Math.min(height - 30, y));

export function addText(
  texts: TextBox[],
  x: number,
  y: number,
  height: number,
  id: string = crypto.randomUUID(),
): TextBox[] {
  return [...texts, { id, x: clampX(x), y: clampY(y, height), text: '' }];
}

export function editText(texts: TextBox[], id: string, text: string): TextBox[] {
  return texts.map((t) => (t.id === id ? { ...t, text } : t));
}

export function moveText(
  texts: TextBox[],
  id: string,
  x: number,
  y: number,
  height: number,
): TextBox[] {
  return texts.map((t) => (t.id === id ? { ...t, x: clampX(x), y: clampY(y, height) } : t));
}

export function removeText(texts: TextBox[], id: string): TextBox[] {
  return texts.filter((t) => t.id !== id);
}

/** Empty boxes left behind (tapped but never typed in) are dropped. */
export const withoutEmpty = (texts: TextBox[]) => texts.filter((t) => t.text.trim());
