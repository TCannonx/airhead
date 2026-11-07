import {
  decodePoints,
  encodePoints,
  PAGE_WIDTH,
  type InkPoint,
  type StoredStroke,
  type TextBox,
} from './strokes';

/**
 * Lasso selection on a handwritten page (Tasks 9.1–9.3). Pure functions over
 * page units: which strokes and text boxes a loop catches, the box around
 * them, and moving them.
 */
export interface Selection {
  /** Indexes into the page's strokes. */
  strokes: number[];
  /** Text box ids. */
  texts: string[];
}

export const EMPTY_SELECTION: Selection = { strokes: [], texts: [] };

/** Even-odd ray casting. */
export function pointInPolygon(
  p: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as { x: number; y: number };
    const b = poly[j] as { x: number; y: number };
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Strokes with at least half their points inside the loop, and text boxes whose corner is. */
export function selectByLasso(
  strokes: StoredStroke[],
  texts: TextBox[],
  loop: InkPoint[],
): Selection {
  if (loop.length < 3) return EMPTY_SELECTION;
  const picked: number[] = [];
  strokes.forEach((s, i) => {
    const pts = decodePoints(s.d);
    if (pts.length === 0) return;
    const inside = pts.filter((p) => pointInPolygon(p, loop)).length;
    if (inside * 2 >= pts.length) picked.push(i);
  });
  return {
    strokes: picked,
    texts: texts.filter((t) => t.text.trim() && pointInPolygon(t, loop)).map((t) => t.id),
  };
}

export const isEmpty = (s: Selection) => s.strokes.length === 0 && s.texts.length === 0;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box around the selection (with a little room), in page units; null when empty. */
export function selectionBox(
  strokes: StoredStroke[],
  texts: TextBox[],
  sel: Selection,
  textWidth = 320,
  textHeight = 40,
): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of sel.strokes) {
    const s = strokes[i];
    if (!s) continue;
    const r = s.width / 2;
    for (const p of decodePoints(s.d)) {
      minX = Math.min(minX, p.x - r);
      minY = Math.min(minY, p.y - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    }
  }
  for (const t of texts.filter((x) => sel.texts.includes(x.id))) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + textWidth);
    maxY = Math.max(maxY, t.y + textHeight);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = 8;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** A stroke moved by (dx, dy). */
export function translateStroke(s: StoredStroke, dx: number, dy: number): StoredStroke {
  return {
    ...s,
    d: encodePoints(decodePoints(s.d).map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))),
  };
}

/** Keeps a move inside the page width and below the top. */
export function clampMove(box: Box, dx: number, dy: number): { dx: number; dy: number } {
  const x = Math.max(0, Math.min(PAGE_WIDTH - box.w, box.x + dx));
  const y = Math.max(0, box.y + dy);
  return { dx: x - box.x, dy: y - box.y };
}
