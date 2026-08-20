import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, COORD_MAX } from '../src/constants.js';
import type { Point } from '../src/protocol.js';
import {
  dequantize,
  fromWire,
  isValidQPoint,
  prepareStroke,
  quantize,
  simplify,
  thinPoints,
  toWire,
} from '../src/strokes.js';

describe('quantize / dequantize', () => {
  it('maps the range endpoints exactly', () => {
    expect(quantize(0)).toBe(0);
    expect(quantize(1)).toBe(COORD_MAX);
    expect(dequantize(0)).toBe(0);
    expect(dequantize(COORD_MAX)).toBe(1);
  });

  it('always produces integers in range', () => {
    for (const v of [0, 0.001, 0.3333, 0.5, 0.9999, 1]) {
      const q = quantize(v);
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(COORD_MAX);
    }
  });

  it('clamps rather than wrapping on out-of-range input', () => {
    expect(quantize(-3)).toBe(0);
    expect(quantize(17)).toBe(COORD_MAX);
    expect(quantize(Number.NaN)).toBe(0);
    expect(quantize(Number.POSITIVE_INFINITY)).toBe(COORD_MAX);
  });

  it('round-trips within half a quantization step', () => {
    const step = 1 / COORD_MAX;
    for (const v of [0.12345, 0.5, 0.98765]) {
      expect(Math.abs(dequantize(quantize(v)) - v)).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
  });

  it('round-trips a canvas point to sub-pixel accuracy', () => {
    const p: Point = [617.4, 233.9];
    const back = fromWire(toWire(p));
    expect(Math.abs(back[0] - p[0])).toBeLessThan(0.5);
    expect(Math.abs(back[1] - p[1])).toBeLessThan(0.5);
  });

  it('maps canvas corners to wire corners', () => {
    expect(toWire([0, 0])).toEqual([0, 0]);
    expect(toWire([CANVAS_W, CANVAS_H])).toEqual([COORD_MAX, COORD_MAX]);
  });
});

describe('isValidQPoint', () => {
  it('accepts well-formed integer pairs in range', () => {
    expect(isValidQPoint([0, 0])).toBe(true);
    expect(isValidQPoint([COORD_MAX, COORD_MAX])).toBe(true);
    expect(isValidQPoint([123, 456])).toBe(true);
  });

  it('rejects hostile shapes', () => {
    expect(isValidQPoint(null)).toBe(false);
    expect(isValidQPoint([1])).toBe(false);
    expect(isValidQPoint([1, 2, 3])).toBe(false);
    expect(isValidQPoint(['1', '2'])).toBe(false);
    expect(isValidQPoint([1.5, 2])).toBe(false);
    expect(isValidQPoint([-1, 2])).toBe(false);
    expect(isValidQPoint([0, COORD_MAX + 1])).toBe(false);
    expect(isValidQPoint([Number.NaN, 0])).toBe(false);
  });
});

describe('thinPoints', () => {
  it('keeps short inputs untouched', () => {
    expect(thinPoints([], 2)).toEqual([]);
    expect(thinPoints([[1, 1]], 2)).toEqual([[1, 1]]);
    expect(
      thinPoints(
        [
          [0, 0],
          [0.1, 0],
        ],
        2,
      ),
    ).toEqual([
      [0, 0],
      [0.1, 0],
    ]);
  });

  it('drops samples closer than the threshold', () => {
    const pts: Point[] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1.5, 0],
      [10, 0],
    ];
    expect(thinPoints(pts, 2)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('keeps samples at or beyond the threshold', () => {
    const pts: Point[] = [
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
    ];
    expect(thinPoints(pts, 2)).toEqual(pts);
  });

  it('always keeps the first and last point', () => {
    const pts: Point[] = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
      [0.3, 0],
    ];
    const out = thinPoints(pts, 5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0.3, 0]);
    expect(out.length).toBe(2);
  });

  it('measures euclidean distance, not per-axis', () => {
    // (3,4) is exactly 5 away from the origin.
    expect(
      thinPoints(
        [
          [0, 0],
          [3, 4],
          [100, 100],
        ],
        5,
      ).length,
    ).toBe(3);
    expect(
      thinPoints(
        [
          [0, 0],
          [3, 4],
          [100, 100],
        ],
        6,
      ).length,
    ).toBe(2);
  });

  it('does not mutate its input', () => {
    const pts: Point[] = [
      [0, 0],
      [0.1, 0],
      [10, 0],
    ];
    thinPoints(pts, 2);
    expect(pts.length).toBe(3);
  });
});

describe('simplify (Ramer-Douglas-Peucker)', () => {
  it('collapses a straight line to its endpoints', () => {
    const line: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    expect(simplify(line, 0.5)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it('keeps a point that deviates beyond epsilon', () => {
    const bend: Point[] = [
      [0, 0],
      [2, 5],
      [4, 0],
    ];
    expect(simplify(bend, 1)).toEqual(bend);
  });

  it('drops a point that deviates less than epsilon', () => {
    const nearlyStraight: Point[] = [
      [0, 0],
      [2, 0.2],
      [4, 0],
    ];
    expect(simplify(nearlyStraight, 1)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it('always preserves the endpoints', () => {
    const pts: Point[] = [
      [0, 0],
      [1, 0.01],
      [2, 0.02],
      [3, 0],
    ];
    const out = simplify(pts, 10);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([3, 0]);
  });

  it('preserves input order', () => {
    const zigzag: Point[] = [
      [0, 0],
      [1, 10],
      [2, 0],
      [3, 10],
      [4, 0],
    ];
    const out = simplify(zigzag, 1);
    expect(out).toEqual(zigzag);
    expect(out.map((p) => p[0])).toEqual([...out.map((p) => p[0])].sort((a, b) => a - b));
  });

  it('never grows the point count', () => {
    const pts: Point[] = Array.from({ length: 200 }, (_, i) => [i, Math.sin(i / 5) * 3] as Point);
    expect(simplify(pts, 1).length).toBeLessThanOrEqual(pts.length);
  });

  it('is a no-op for degenerate inputs', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([[1, 1]], 1)).toEqual([[1, 1]]);
    expect(simplify([[0, 0]], 0)).toEqual([[0, 0]]);
  });

  it('returns the input unchanged when epsilon is zero', () => {
    const pts: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    expect(simplify(pts, 0)).toEqual(pts);
  });

  it('handles a duplicated segment endpoint without NaN', () => {
    const pts: Point[] = [
      [5, 5],
      [7, 9],
      [5, 5],
    ];
    const out = simplify(pts, 1);
    expect(out.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    expect(out).toEqual(pts);
  });

  it('does not blow the stack on a pathological stroke', () => {
    // Every point deviates, so the split stack goes as deep as the input is
    // long. A recursive implementation overflows here; the iterative one does
    // not. `MAX_POINTS_PER_MSG` keeps real traffic far below this.
    const pts: Point[] = Array.from({ length: 10_000 }, (_, i) => [i, i % 2] as Point);
    let out: Point[] = [];
    expect(() => {
      out = simplify(pts, 0.1);
    }).not.toThrow();
    expect(out.length).toBe(pts.length);
  });
});

describe('prepareStroke', () => {
  it('cuts a dense hand-drawn line down substantially', () => {
    // 120Hz sampling of a slow drag produces a lot of near-duplicate points.
    const dense: Point[] = Array.from({ length: 300 }, (_, i) => [i * 0.4, 0] as Point);
    const out = prepareStroke(dense, 2, 0.75);
    expect(out.length).toBeLessThan(dense.length / 4);
  });

  it('keeps the shape of a curve recognisable', () => {
    const arc: Point[] = Array.from({ length: 200 }, (_, i) => {
      const t = (i / 199) * Math.PI;
      return [Math.cos(t) * 300 + 400, Math.sin(t) * 300 + 400] as Point;
    });
    const out = prepareStroke(arc, 2, 0.75);
    expect(out.length).toBeGreaterThan(8);
    expect(out.length).toBeLessThan(arc.length);
    expect(out[0]).toEqual(arc[0]);
    expect(out[out.length - 1]).toEqual(arc[arc.length - 1]);
  });

  it('leaves a two-point stroke alone', () => {
    const pts: Point[] = [
      [10, 10],
      [200, 200],
    ];
    expect(prepareStroke(pts, 2, 0.75)).toEqual(pts);
  });
});
