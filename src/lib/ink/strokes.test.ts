import { describe, expect, it } from 'vitest';
import {
  decodePoints,
  encodePoints,
  grownHeight,
  hits,
  readInk,
  simplify,
  strokePath,
  UndoStack,
  type StoredStroke,
} from './strokes';

const stroke = (pts: [number, number][], width = 3): StoredStroke => ({
  tool: 'pen',
  color: '#111827',
  width,
  d: encodePoints(pts.map(([x, y]) => ({ x, y, p: 0.5 }))),
});

describe('stroke data (Task 6.5)', () => {
  it('encodes points compactly (half units, deltas) and decodes them back', () => {
    const pts = [
      { x: 10.2, y: 20.7, p: 0.4 },
      { x: 11, y: 21, p: 0.45 },
      { x: 12.5, y: 21.2, p: 0.5 },
    ];
    const d = encodePoints(pts);
    expect(d).toEqual([20, 41, 40, 2, 1, 5, 3, 0, 5]);
    expect(decodePoints(d)).toEqual([
      { x: 10, y: 20.5, p: 0.4 },
      { x: 11, y: 21, p: 0.45 },
      { x: 12.5, y: 21, p: 0.5 },
    ]);
  });

  it('drops pointer noise', () => {
    const pts = [
      { x: 0, y: 0, p: 0.5 },
      { x: 0.1, y: 0.1, p: 0.5 },
      { x: 2, y: 0, p: 0.5 },
    ];
    expect(simplify(pts)).toHaveLength(2);
  });

  it('draws a closed SVG path with perfect-freehand', () => {
    const path = strokePath(
      stroke([
        [0, 0],
        [50, 10],
        [100, 0],
      ]),
    );
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(strokePath({ tool: 'pen', width: 3, d: [] })).toBe('');
  });

  it('the eraser hits a stroke near its line, not far away', () => {
    const s = stroke([
      [0, 0],
      [100, 0],
    ]);
    expect(hits(s, { x: 50, y: 4, p: 0.5 })).toBe(true);
    expect(hits(s, { x: 50, y: 30, p: 0.5 })).toBe(false);
    expect(hits(s, { x: 120, y: 0, p: 0.5 })).toBe(false);
    expect(hits(stroke([[5, 5]]), { x: 7, y: 7, p: 0.5 })).toBe(true);
  });

  it('the page grows as writing nears the bottom', () => {
    expect(grownHeight(1400, 900)).toBe(1400);
    expect(grownHeight(1400, 1200)).toBe(2000);
    expect(grownHeight(1400, 2500)).toBe(3200);
  });

  it('undo and redo for drawing and erasing', () => {
    const u = new UndoStack();
    const a = stroke([
      [0, 0],
      [10, 0],
    ]);
    const b = stroke([
      [0, 20],
      [10, 20],
    ]);
    const c = stroke([
      [0, 40],
      [10, 40],
    ]);
    let s: StoredStroke[] = [];
    s = u.apply(s, { kind: 'add', stroke: a });
    s = u.apply(s, { kind: 'add', stroke: b });
    s = u.apply(s, { kind: 'add', stroke: c });
    s = u.apply(s, {
      kind: 'erase',
      removed: [
        { index: 0, stroke: a },
        { index: 2, stroke: c },
      ],
    });
    expect(s).toEqual([b]);
    s = u.undo(s);
    expect(s).toEqual([a, b, c]);
    s = u.undo(s);
    expect(s).toEqual([a, b]);
    s = u.redo(s);
    expect(s).toEqual([a, b, c]);
    expect(u.canRedo).toBe(true);
    // A new change clears redo.
    u.apply(s, { kind: 'add', stroke: a });
    expect(u.canRedo).toBe(false);
    expect(u.undo([])).toEqual([]);
  });

  it('reads stored ink documents, filling gaps', () => {
    expect(readInk({})).toEqual({ width: 1000, pages: [{ height: 1400, strokes: [], texts: [] }] });
    expect(readInk({ width: 1000, pages: [{ height: 2000 }] }).pages[0]?.height).toBe(2000);
  });
});
