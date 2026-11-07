import { describe, expect, it } from 'vitest';
import { drawPage, pageHasContent, pageScale, wrapLines, type DrawTarget } from './render';
import { encodePoints, type InkPage } from './strokes';

function fakeCtx() {
  const calls: string[] = [];
  const ctx: DrawTarget = {
    fillStyle: '',
    globalAlpha: 1,
    font: '',
    textBaseline: '',
    setTransform: (a) => calls.push(`scale ${a}`),
    fillRect: (_x, _y, w, h) => calls.push(`rect ${w}x${h} ${ctx.fillStyle}`),
    fill: (p) => calls.push(`fill ${String(p).slice(0, 1)} ${ctx.fillStyle} ${ctx.globalAlpha}`),
    fillText: (t) => calls.push(`text ${t}`),
    measureText: (s) => ({ width: s.length * 14 }),
  };
  return { ctx, calls };
}

const stroke = (tool: 'pen' | 'highlighter', color: string) => ({
  tool,
  color,
  width: 4,
  d: encodePoints([
    { x: 10, y: 10, p: 0.5 },
    { x: 60, y: 40, p: 0.5 },
    { x: 120, y: 50, p: 0.5 },
  ]),
});

describe('ink pages as images (Task 6.7)', () => {
  it('skips empty pages', () => {
    expect(pageHasContent({ height: 1400, strokes: [], texts: [] })).toBe(false);
    expect(
      pageHasContent({ height: 1400, strokes: [], texts: [{ id: 'a', x: 0, y: 0, text: ' ' }] }),
    ).toBe(false);
    expect(pageHasContent({ height: 1400, strokes: [stroke('pen', '#000')], texts: [] })).toBe(
      true,
    );
  });

  it('keeps the long side within 2000 px', () => {
    expect(pageScale(1400)).toBe(1);
    expect(pageScale(4000)).toBe(0.5);
  });

  it('wraps text box lines to the box width', () => {
    expect(wrapLines('one two three four', 100, (s) => s.length * 14)).toEqual([
      'one two',
      'three',
      'four',
    ]);
    expect(wrapLines('a\nb', 100, (s) => s.length)).toEqual(['a', 'b']);
  });

  it('draws a white page, strokes (highlighter see-through) and text boxes', () => {
    const { ctx, calls } = fakeCtx();
    const page: InkPage = {
      height: 1400,
      strokes: [stroke('pen', '#111111'), stroke('highlighter', '#facc15')],
      texts: [{ id: 't', x: 100, y: 200, text: 'Agenda' }],
    };
    drawPage(ctx, page, 1, (d) => d);
    expect(calls).toEqual([
      'scale 1',
      'rect 1000x1400 #ffffff',
      'fill M #111111 1',
      'fill M #facc15 0.35',
      'text Agenda',
    ]);
  });
});
