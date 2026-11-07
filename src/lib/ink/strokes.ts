import getStroke from 'perfect-freehand';

/**
 * Handwritten pages (Task 6.5). Strokes are stored as compact point data, not
 * images: coordinates in page units (the page is 1000 wide) rounded to half a
 * unit, pressure to 1/100, and every point after the first stored as the
 * difference from the one before (small integers compress and sync well).
 */
export type Tool = 'pen' | 'highlighter';

export interface InkPoint {
  x: number;
  y: number;
  /** 0–1; 0.5 when the device doesn't report pressure. */
  p: number;
}

export interface StoredStroke {
  tool: Tool;
  color: string;
  width: number;
  /** [x, y, p, dx, dy, dp, …] with x, y in half units and p in hundredths. */
  d: number[];
}

export interface TextBox {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface InkPage {
  height: number;
  strokes: StoredStroke[];
  texts: TextBox[];
}

export interface InkDoc {
  width: number;
  pages: InkPage[];
}

export const PAGE_WIDTH = 1000;
export const START_HEIGHT = 1400;
/** Writing this close to the bottom adds more page. */
export const GROW_MARGIN = 250;
export const GROW_BY = 600;

export function encodePoints(points: InkPoint[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  let pp = 0;
  points.forEach((pt, i) => {
    const x = Math.round(pt.x * 2);
    const y = Math.round(pt.y * 2);
    const p = Math.round(Math.max(0, Math.min(1, pt.p)) * 100);
    if (i === 0) out.push(x, y, p);
    else out.push(x - px, y - py, p - pp);
    px = x;
    py = y;
    pp = p;
  });
  return out;
}

export function decodePoints(d: number[]): InkPoint[] {
  const out: InkPoint[] = [];
  let x = 0;
  let y = 0;
  let p = 0;
  for (let i = 0; i + 2 < d.length; i += 3) {
    x += d[i] ?? 0;
    y += d[i + 1] ?? 0;
    p += d[i + 2] ?? 0;
    out.push({ x: x / 2, y: y / 2, p: p / 100 });
  }
  return out;
}

/** Drops points closer than half a unit to the last kept one (pointer noise). */
export function simplify(points: InkPoint[]): InkPoint[] {
  const out: InkPoint[] = [];
  for (const pt of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.5) out.push(pt);
  }
  return out;
}

/** Closed SVG path for a stroke, drawn with perfect-freehand. */
export function strokePath(s: Pick<StoredStroke, 'tool' | 'width' | 'd'>): string {
  const pts = decodePoints(s.d);
  if (pts.length === 0) return '';
  const outline = getStroke(
    pts.map((p) => [p.x, p.y, p.p]),
    {
      size: s.width,
      thinning: s.tool === 'highlighter' ? 0 : 0.55,
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: pts.every((p) => p.p === 0.5),
      last: true,
    },
  );
  if (outline.length < 2) return '';
  const [first, ...rest] = outline;
  let d = `M${(first?.[0] ?? 0).toFixed(1)} ${(first?.[1] ?? 0).toFixed(1)}`;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? [0, 0];
    const b = rest[i + 1] ?? first ?? [0, 0];
    d += ` Q${a[0].toFixed(1)} ${a[1].toFixed(1)} ${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`;
  }
  return `${d} Z`;
}

const distToSegment = (p: InkPoint, a: InkPoint, b: InkPoint) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** The stroke eraser: does this point touch the stroke (within its width plus a margin)? */
export function hits(stroke: StoredStroke, at: InkPoint, margin = 6): boolean {
  const pts = decodePoints(stroke.d);
  const reach = stroke.width / 2 + margin;
  if (pts.length === 1)
    return Math.hypot(at.x - (pts[0]?.x ?? 0), at.y - (pts[0]?.y ?? 0)) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(at, pts[i - 1] ?? at, pts[i] ?? at) <= reach) return true;
  }
  return false;
}

/** The page grows when writing gets near its bottom. */
export function grownHeight(height: number, lowestY: number): number {
  let h = height;
  while (lowestY > h - GROW_MARGIN) h += GROW_BY;
  return h;
}

/** One undoable change to a page. */
export type InkOp =
  | { kind: 'add'; stroke: StoredStroke }
  | { kind: 'erase'; removed: { index: number; stroke: StoredStroke }[] }
  /** Lasso move (Task 9.2): these strokes shifted by (dx, dy). */
  | { kind: 'move'; indices: number[]; dx: number; dy: number }
  /** Paste (Task 9.3): strokes appended at the end. */
  | { kind: 'paste'; strokes: StoredStroke[] }
  /** Hold-to-snap (Task 9.4): a stroke swapped for its clean shape. */
  | { kind: 'replace'; index: number; before: StoredStroke; after: StoredStroke };

/** Undo and redo over a page's strokes. */
export class UndoStack {
  private done: InkOp[] = [];
  private undone: InkOp[] = [];

  apply(strokes: StoredStroke[], op: InkOp): StoredStroke[] {
    this.done.push(op);
    this.undone = [];
    return run(strokes, op);
  }

  undo(strokes: StoredStroke[]): StoredStroke[] {
    const op = this.done.pop();
    if (!op) return strokes;
    this.undone.push(op);
    return revert(strokes, op);
  }

  redo(strokes: StoredStroke[]): StoredStroke[] {
    const op = this.undone.pop();
    if (!op) return strokes;
    this.done.push(op);
    return run(strokes, op);
  }

  get canUndo() {
    return this.done.length > 0;
  }

  get canRedo() {
    return this.undone.length > 0;
  }
}

function shift(strokes: StoredStroke[], indices: number[], dx: number, dy: number) {
  const set = new Set(indices);
  return strokes.map((st, i) =>
    set.has(i)
      ? {
          ...st,
          d: encodePoints(decodePoints(st.d).map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))),
        }
      : st,
  );
}

function run(strokes: StoredStroke[], op: InkOp): StoredStroke[] {
  if (op.kind === 'add') return [...strokes, op.stroke];
  if (op.kind === 'move') return shift(strokes, op.indices, op.dx, op.dy);
  if (op.kind === 'paste') return [...strokes, ...op.strokes];
  if (op.kind === 'replace') return strokes.map((st, i) => (i === op.index ? op.after : st));
  const gone = new Set(op.removed.map((r) => r.index));
  return strokes.filter((_, i) => !gone.has(i));
}

function revert(strokes: StoredStroke[], op: InkOp): StoredStroke[] {
  if (op.kind === 'add') return strokes.slice(0, -1);
  if (op.kind === 'move') return shift(strokes, op.indices, -op.dx, -op.dy);
  if (op.kind === 'paste') return strokes.slice(0, strokes.length - op.strokes.length);
  if (op.kind === 'replace') return strokes.map((st, i) => (i === op.index ? op.before : st));
  const out = [...strokes];
  for (const r of [...op.removed].sort((a, b) => a.index - b.index))
    out.splice(r.index, 0, r.stroke);
  return out;
}

/** Reads a stored ink document, filling anything missing. */
export function readInk(doc: Record<string, unknown>): InkDoc {
  const pages = Array.isArray(doc.pages) ? (doc.pages as Partial<InkPage>[]) : [];
  const first = pages[0] ?? {};
  return {
    width: typeof doc.width === 'number' ? doc.width : PAGE_WIDTH,
    pages: [
      {
        height: typeof first.height === 'number' ? first.height : START_HEIGHT,
        strokes: Array.isArray(first.strokes) ? first.strokes : [],
        texts: Array.isArray(first.texts) ? first.texts : [],
      },
    ],
  };
}
