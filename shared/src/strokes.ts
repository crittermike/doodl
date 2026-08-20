/**
 * Stroke geometry: quantization, thinning and simplification.
 *
 * The pipeline on the drawing client is:
 *
 *   pointermove  ->  buffer (canvas px)
 *                ->  thinPoints()      drop near-duplicate samples
 *                ->  simplify()        Ramer-Douglas-Peucker
 *                ->  normalize + quantize to Q12
 *                ->  one message every STROKE_FLUSH_MS
 *
 * Buffering matters more than any of the maths: `pointermove` fires at up to
 * 120Hz on a high-refresh display, and sending each event individually floods
 * the socket for no visible gain.
 */

import { CANVAS_H, CANVAS_W, COORD_MAX } from './constants.js';
import type { Point, QPoint } from './protocol.js';

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

/** Normalized 0..1 -> 12-bit integer 0..4095. */
export function quantize(v: number): number {
  if (Number.isNaN(v)) return 0;
  const q = Math.round(v * COORD_MAX);
  // `!(q > 0)` also catches -Infinity and negative zero.
  if (!(q > 0)) return 0;
  return q > COORD_MAX ? COORD_MAX : q;
}

/** 12-bit integer 0..4095 -> normalized 0..1. */
export function dequantize(q: number): number {
  return q / COORD_MAX;
}

/** Canvas-pixel point -> wire point. */
export function toWire(p: Point): QPoint {
  return [quantize(p[0] / CANVAS_W), quantize(p[1] / CANVAS_H)];
}

/** Wire point -> canvas-pixel point. */
export function fromWire(q: QPoint): Point {
  return [dequantize(q[0]) * CANVAS_W, dequantize(q[1]) * CANVAS_H];
}

export function toWireAll(pts: readonly Point[]): QPoint[] {
  return pts.map(toWire);
}

export function fromWireAll(pts: readonly QPoint[]): Point[] {
  return pts.map(fromWire);
}

/** True if `q` is a structurally valid wire point. */
export function isValidQPoint(q: unknown): q is QPoint {
  return (
    Array.isArray(q) &&
    q.length === 2 &&
    Number.isInteger(q[0]) &&
    Number.isInteger(q[1]) &&
    (q[0] as number) >= 0 &&
    (q[0] as number) <= COORD_MAX &&
    (q[1] as number) >= 0 &&
    (q[1] as number) <= COORD_MAX
  );
}

// ---------------------------------------------------------------------------
// Thinning
// ---------------------------------------------------------------------------

/**
 * Drop any point closer than `minDist` to the last point we kept.
 *
 * The first point is always kept. The last point is always kept too, because
 * dropping it would visibly shorten the stroke where the user lifted the pen.
 */
export function thinPoints(pts: readonly Point[], minDist: number): Point[] {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]] as Point);

  const min2 = minDist * minDist;
  const out: Point[] = [[pts[0]![0], pts[0]![1]]];
  let last = pts[0]!;

  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const dx = p[0] - last[0];
    const dy = p[1] - last[1];
    if (dx * dx + dy * dy >= min2) {
      out.push([p[0], p[1]]);
      last = p;
    }
  }

  const end = pts[pts.length - 1]!;
  out.push([end[0], end[1]]);
  return out;
}

// ---------------------------------------------------------------------------
// Ramer-Douglas-Peucker
// ---------------------------------------------------------------------------

/** Perpendicular distance from `p` to the segment `a`-`b`. */
function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];

  if (dx === 0 && dy === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }

  // Project onto the segment, clamped to its extent.
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy));
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 *
 * Iterative rather than recursive so that a very long stroke can't blow the
 * call stack — a hostile client could otherwise send one.
 */
export function simplify(pts: readonly Point[], epsilon: number): Point[] {
  const n = pts.length;
  if (n <= 2 || epsilon <= 0) return pts.map((p) => [p[0], p[1]] as Point);

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let maxDist = -1;
    let index = -1;
    const a = pts[first]!;
    const b = pts[last]!;

    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(pts[i]!, a, b);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (maxDist > epsilon && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push([pts[i]![0], pts[i]![1]]);
  }
  return out;
}

/**
 * The full client-side reduction: thin, then simplify.
 *
 * Exported as one function so the unit tests exercise the same composition the
 * drawing engine uses.
 */
export function prepareStroke(pts: readonly Point[], minDist: number, epsilon: number): Point[] {
  return simplify(thinPoints(pts, minDist), epsilon);
}
