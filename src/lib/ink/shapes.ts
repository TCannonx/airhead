import type { InkPoint } from './strokes';

/**
 * Hold-to-snap shapes (Task 9.4): recognise a hand-drawn line, arrow,
 * rectangle or circle/ellipse from a stroke's points and return clean points
 * for the same stroke. Anything unclear returns null and stays as drawn.
 * Pure geometry in page units.
 */
export type ShapeKind = 'line' | 'arrow' | 'rectangle' | 'ellipse';

export interface Snapped {
  kind: ShapeKind;
  points: InkPoint[];
}

type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const pathLength = (pts: P[]) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i] as P), 0);

/** Distance from p to the line through a and b. */
function lineDistance(p: P, a: P, b: P): number {
  const len = dist(a, b);
  if (len === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
}

const pt = (x: number, y: number): InkPoint => ({
  x: Math.round(x * 2) / 2,
  y: Math.round(y * 2) / 2,
  p: 0.5,
});

/** Points along a straight segment (perfect-freehand wants a few). */
function segment(a: P, b: P, steps = 8): InkPoint[] {
  return Array.from({ length: steps + 1 }, (_, i) =>
    pt(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps),
  );
}

function isStraight(pts: P[], tolerance = 0.06): boolean {
  const a = pts[0] as P;
  const b = pts[pts.length - 1] as P;
  const len = dist(a, b);
  if (len < 40) return false;
  const max = Math.max(...pts.map((p) => lineDistance(p, a, b)));
  return max <= Math.max(6, len * tolerance) && pathLength(pts) <= len * 1.15;
}

function asLine(pts: P[]): Snapped | null {
  if (!isStraight(pts)) return null;
  return { kind: 'line', points: segment(pts[0] as P, pts[pts.length - 1] as P) };
}

/** A shaft, then a head drawn from the tip in the same stroke (tip → wing → tip → wing, or a ‹). */
function asArrow(pts: P[]): Snapped | null {
  const start = pts[0] as P;
  let tipIndex = 0;
  pts.forEach((p, i) => {
    if (dist(p, start) > dist(pts[tipIndex] as P, start)) tipIndex = i;
  });
  const shaft = pts.slice(0, tipIndex + 1);
  const head = pts.slice(tipIndex);
  const tip = pts[tipIndex] as P;
  const shaftLen = dist(start, tip);
  if (head.length < 3 || !isStraight(shaft, 0.08)) return null;
  const headLen = pathLength(head);
  if (headLen < shaftLen * 0.12 || headLen > shaftLen * 0.9) return null;
  // The head stays near the tip and sits behind it (towards the start).
  if (head.some((p) => dist(p, tip) > shaftLen * 0.4)) return null;
  const ux = (tip.x - start.x) / shaftLen;
  const uy = (tip.y - start.y) / shaftLen;
  const behind = head.filter((p) => (p.x - tip.x) * ux + (p.y - tip.y) * uy < -shaftLen * 0.03);
  if (behind.length < head.length * 0.4) return null;
  // Both sides of the shaft are visited (a real head, not a hook).
  const side = (p: P) => (p.x - tip.x) * -uy + (p.y - tip.y) * ux;
  if (!head.some((p) => side(p) > 4) || !head.some((p) => side(p) < -4)) return null;
  const wing = Math.min(shaftLen * 0.2, 40);
  const ang = Math.PI / 6;
  const back = { x: -ux, y: -uy };
  const rot = (v: P, a: number) => ({
    x: v.x * Math.cos(a) - v.y * Math.sin(a),
    y: v.x * Math.sin(a) + v.y * Math.cos(a),
  });
  const w1 = rot(back, ang);
  const w2 = rot(back, -ang);
  const wing1 = { x: tip.x + w1.x * wing, y: tip.y + w1.y * wing };
  const wing2 = { x: tip.x + w2.x * wing, y: tip.y + w2.y * wing };
  return {
    kind: 'arrow',
    points: [
      ...segment(start, tip),
      ...segment(tip, wing1, 3).slice(1),
      ...segment(wing1, tip, 3).slice(1),
      ...segment(tip, wing2, 3).slice(1),
    ],
  };
}

function bounds(pts: P[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function isClosed(pts: P[]): boolean {
  const len = pathLength(pts);
  return len > 120 && dist(pts[0] as P, pts[pts.length - 1] as P) <= len * 0.15;
}

function asEllipse(pts: P[]): Snapped | null {
  const b = bounds(pts);
  if (b.w < 30 || b.h < 30) return null;
  const cx = b.minX + b.w / 2;
  const cy = b.minY + b.h / 2;
  const rx = b.w / 2;
  const ry = b.h / 2;
  const r = pts.map((p) => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / r.length);
  if (sd > 0.09 || Math.abs(mean - 1) > 0.15) return null;
  const n = 48;
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return pt(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  });
  return { kind: 'ellipse', points };
}

function asRectangle(pts: P[]): Snapped | null {
  const b = bounds(pts);
  if (b.w < 30 || b.h < 30) return null;
  const tol = Math.max(8, Math.min(b.w, b.h) * 0.1);
  const onEdge = pts.filter(
    (p) =>
      Math.abs(p.x - b.minX) <= tol ||
      Math.abs(p.x - (b.minX + b.w)) <= tol ||
      Math.abs(p.y - b.minY) <= tol ||
      Math.abs(p.y - (b.minY + b.h)) <= tol,
  ).length;
  if (onEdge < pts.length * 0.92) return null;
  const tl = { x: b.minX, y: b.minY };
  const tr = { x: b.minX + b.w, y: b.minY };
  const br = { x: b.minX + b.w, y: b.minY + b.h };
  const bl = { x: b.minX, y: b.minY + b.h };
  return {
    kind: 'rectangle',
    points: [
      ...segment(tl, tr),
      ...segment(tr, br).slice(1),
      ...segment(br, bl).slice(1),
      ...segment(bl, tl).slice(1),
    ],
  };
}

/** The clean shape for a stroke, or null to leave it as drawn. */
export function recognise(points: InkPoint[]): Snapped | null {
  if (points.length < 4) return null;
  const line = asLine(points);
  if (line) return line;
  if (isClosed(points)) return asEllipse(points) ?? asRectangle(points);
  return asArrow(points);
}
