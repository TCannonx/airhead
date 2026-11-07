import { describe, expect, it } from 'vitest';
import {
  clampMove,
  pointInPolygon,
  selectByLasso,
  selectionBox,
  translateStroke,
} from './selection';
import { decodePoints, encodePoints, type StoredStroke, type TextBox } from './strokes';

const stroke = (pts: [number, number][]): StoredStroke => ({
  tool: 'pen',
  color: '#000',
  width: 4,
  d: encodePoints(pts.map(([x, y]) => ({ x, y, p: 0.5 }))),
});
const square = [
  { x: 100, y: 100, p: 0.5 },
  { x: 300, y: 100, p: 0.5 },
  { x: 300, y: 300, p: 0.5 },
  { x: 100, y: 300, p: 0.5 },
];

describe('lasso selection (Task 9.1)', () => {
  it('point in polygon', () => {
    expect(pointInPolygon({ x: 200, y: 200 }, square)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 200 }, square)).toBe(false);
    expect(pointInPolygon({ x: 350, y: 350 }, square)).toBe(false);
  });

  it('catches strokes mostly inside, and text boxes whose corner is inside', () => {
    const strokes = [
      stroke([
        [150, 150],
        [200, 200],
        [250, 250],
      ]), // inside
      stroke([
        [250, 200],
        [350, 200],
        [400, 200],
        [500, 200],
      ]), // mostly outside
      stroke([
        [500, 500],
        [600, 600],
      ]), // outside
    ];
    const texts: TextBox[] = [
      { id: 'in', x: 120, y: 120, text: 'Agenda' },
      { id: 'out', x: 500, y: 500, text: 'Later' },
      { id: 'empty', x: 130, y: 130, text: '  ' },
    ];
    expect(selectByLasso(strokes, texts, square)).toEqual({ strokes: [0], texts: ['in'] });
    expect(selectByLasso(strokes, texts, square.slice(0, 2))).toEqual({ strokes: [], texts: [] });
  });

  it('the selection box wraps strokes (with their width) and text boxes', () => {
    const strokes = [
      stroke([
        [150, 150],
        [250, 250],
      ]),
    ];
    const texts: TextBox[] = [{ id: 't', x: 200, y: 260, text: 'x' }];
    expect(selectionBox(strokes, texts, { strokes: [0], texts: ['t'] }, 100, 30)).toEqual({
      x: 140,
      y: 140,
      w: 168,
      h: 158,
    });
    expect(selectionBox(strokes, texts, { strokes: [], texts: [] })).toBeNull();
  });

  it('moves strokes and keeps a move inside the page', () => {
    const moved = translateStroke(
      stroke([
        [10, 20],
        [30, 40],
      ]),
      5,
      -10,
    );
    expect(decodePoints(moved.d).map((p) => [p.x, p.y])).toEqual([
      [15, 10],
      [35, 30],
    ]);
    expect(clampMove({ x: 900, y: 10, w: 80, h: 50 }, 100, -50)).toEqual({ dx: 20, dy: -10 });
  });
});

describe('move and delete (Task 9.2)', () => {
  it('a move is one undo step, and redo moves it again', async () => {
    const { UndoStack } = await import('./strokes');
    const undo = new UndoStack();
    const a = stroke([
      [10, 10],
      [20, 20],
    ]);
    const b = stroke([
      [50, 50],
      [60, 60],
    ]);
    const moved = undo.apply([a, b], { kind: 'move', indices: [1], dx: 100, dy: 5 });
    expect(decodePoints(moved[1]?.d ?? [])[0]).toMatchObject({ x: 150, y: 55 });
    expect(moved[0]).toBe(a);
    const back = undo.undo(moved);
    expect(decodePoints(back[1]?.d ?? [])[0]).toMatchObject({ x: 50, y: 50 });
    const again = undo.redo(back);
    expect(decodePoints(again[1]?.d ?? [])[0]).toMatchObject({ x: 150, y: 55 });
  });
});
