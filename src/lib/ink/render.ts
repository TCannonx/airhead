import { PAGE_WIDTH, strokePath, type InkDoc, type InkPage } from './strokes';
import { TEXT_BOX_WIDTH } from './texts';

/**
 * Handwritten pages as PNG images for Summarise (Task 6.7, vision). Pages are
 * drawn on a white canvas at a scale that keeps the long side within
 * MAX_SIDE pixels (the model reads that size fine and uploads stay small).
 * Empty pages are skipped; at most MAX_PAGES are sent.
 */
export const MAX_PAGES = 4;
export const MAX_SIDE = 2000;
export const TEXT_SIZE = 28;

export const pageHasContent = (p: InkPage) =>
  p.strokes.length > 0 || p.texts.some((t) => t.text.trim());

export function pageScale(height: number): number {
  return Math.min(1, MAX_SIDE / Math.max(PAGE_WIDTH, height));
}

/** The 2D-context calls drawing needs (a fake in tests; jsdom has no canvas). */
export interface DrawTarget {
  fillStyle: string;
  globalAlpha: number;
  font: string;
  textBaseline: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fill(path: unknown): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

/** Breaks a text box's text into lines that fit its width. */
export function wrapLines(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function drawPage(
  ctx: DrawTarget,
  page: InkPage,
  scale: number,
  makePath: (d: string) => unknown,
): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_WIDTH, page.height);
  for (const s of page.strokes) {
    const d = strokePath(s);
    if (!d) continue;
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
    ctx.fillStyle = s.color;
    ctx.fill(makePath(d));
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f172a';
  ctx.font = `${TEXT_SIZE}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (const t of page.texts) {
    if (!t.text.trim()) continue;
    const lines = wrapLines(t.text, TEXT_BOX_WIDTH, (s) => ctx.measureText(s).width);
    lines.forEach((l, i) => ctx.fillText(l, t.x + 8, t.y + 6 + i * TEXT_SIZE * 1.3));
  }
}

/** Base64 PNGs (no data: prefix) of the pages with something on them, in order. */
export async function renderInkPages(doc: InkDoc): Promise<string[]> {
  const pages = doc.pages.filter(pageHasContent).slice(0, MAX_PAGES);
  const out: string[] = [];
  for (const page of pages) {
    const scale = pageScale(page.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_WIDTH * scale);
    canvas.height = Math.round(page.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser can’t draw the page.');
    drawPage(ctx as unknown as DrawTarget, page, scale, (d) => new Path2D(d));
    const url = canvas.toDataURL('image/png');
    out.push(url.slice(url.indexOf(',') + 1));
  }
  return out;
}
