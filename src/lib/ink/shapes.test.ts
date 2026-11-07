import { describe, expect, it } from 'vitest';
import { recognise } from './shapes';
import type { InkPoint } from './strokes';

/** A small deterministic wobble, so tests don't depend on Math.random. */
const wobble = (i: number, amount: number) => Math.sin(i * 1.7) * amount;
const p = (x: number, y: number): InkPoint => ({ x, y, p: 0.5 });

const line = (n = 30, amount = 2) =>
  Array.from({ length: n }, (_, i) => p(100 + i * 10, 200 + i * 3 + wobble(i, amount)));

const ellipse = (rx: number, ry: number, amount = 3) =>
  Array.from({ length: 60 }, (_, i) => {
    const t = (i / 59) * Math.PI * 2;
    return p(
      400 + (rx + wobble(i, amount)) * Math.cos(t),
      400 + (ry + wobble(i, amount)) * Math.sin(t),
    );
  });

const rectangle = (w: number, h: number, amount = 2) => {
  const pts: InkPoint[] = [];
  const corners: [number, number][] = [
    [100, 100],
    [100 + w, 100],
    [100 + w, 100 + h],
    [100, 100 + h],
    [100, 100],
  ];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c] as [number, number];
    const [bx, by] = corners[c + 1] as [number, number];
    for (let i = 0; i < 15; i++)
      pts.push(
        p(
          ax + ((bx - ax) * i) / 15 + wobble(i + c, amount),
          ay + ((by - ay) * i) / 15 + wobble(i, amount),
        ),
      );
  }
  pts.push(p(101, 102));
  return pts;
};

const arrow = () => [
  ...Array.from({ length: 20 }, (_, i) => p(100 + i * 15, 300 + wobble(i, 1.5))), // shaft to (385, 300)
  p(370, 285),
  p(360, 278),
  p(372, 290),
  p(385, 300),
  p(372, 310),
  p(360, 322),
];

describe('hold-to-snap shapes (Task 9.4)', () => {
  it('a wobbly straight stroke becomes a clean line from end to end', () => {
    const s = recognise(line());
    expect(s?.kind).toBe('line');
    expect(s?.points[0]).toMatchObject({ x: 100, y: 200 });
    expect(s?.points.at(-1)?.x).toBe(390);
  });

  it('circles and ellipses', () => {
    expect(recognise(ellipse(100, 100))?.kind).toBe('ellipse');
    expect(recognise(ellipse(150, 60))?.kind).toBe('ellipse');
  });

  it('rectangles snap to their bounding box', () => {
    const s = recognise(rectangle(200, 120));
    expect(s?.kind).toBe('rectangle');
    const xs = s?.points.map((q) => q.x) ?? [];
    expect(Math.round(Math.max(...xs) - Math.min(...xs))).toBeGreaterThan(195);
  });

  it('an arrow drawn in one go keeps its tip and gets a clean head', () => {
    const s = recognise(arrow());
    expect(s?.kind).toBe('arrow');
    expect(s?.points[0]).toMatchObject({ x: 100 });
    expect(s?.points.some((q) => Math.abs(q.x - 385) < 1 && Math.abs(q.y - 300) < 2)).toBe(true);
  });

  it('scribbles, short marks and open curves stay as drawn', () => {
    const scribble = Array.from({ length: 40 }, (_, i) =>
      p(100 + (i % 7) * 20, 100 + (i % 5) * 25 + i),
    );
    expect(recognise(scribble)).toBeNull();
    expect(recognise([p(0, 0), p(5, 5), p(10, 10), p(12, 12)])).toBeNull();
    const halfCircle = Array.from({ length: 30 }, (_, i) => {
      const t = (i / 29) * Math.PI;
      return p(300 + 100 * Math.cos(t), 300 + 100 * Math.sin(t));
    });
    expect(recognise(halfCircle)).toBeNull();
  });
});

describe('snap undo (Task 9.4)', () => {
  it('replace swaps the stroke; undo brings back the hand-drawn one, then removes it', async () => {
    const { UndoStack, encodePoints } = await import('./strokes');
    const undo = new UndoStack();
    const drawn = { tool: 'pen' as const, color: '#000', width: 4, d: encodePoints(line()) };
    const shape = recognise(line());
    const clean = { ...drawn, d: encodePoints(shape?.points ?? []) };
    let strokes = undo.apply([], { kind: 'add', stroke: drawn });
    strokes = undo.apply(strokes, { kind: 'replace', index: 0, before: drawn, after: clean });
    expect(strokes).toEqual([clean]);
    strokes = undo.undo(strokes);
    expect(strokes).toEqual([drawn]);
    expect(undo.undo(strokes)).toEqual([]);
  });
});
