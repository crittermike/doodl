/**
 * Scanline flood fill over a Canvas 2D ImageData buffer.
 *
 * Each client runs this locally: only the origin point and the colour go over
 * the wire, never the resulting pixels.
 *
 * Because every client rasterizes on an identically sized backing store, the
 * results are near-identical. They are not bit-identical, because Canvas 2D
 * offers no way to turn off stroke antialiasing, so the soft edge of a line can
 * be a shade different between browsers and a fill can bleed one pixel further
 * on one machine than another. The `tolerance` below absorbs almost all of it.
 * skribbl.io has exactly the same artifact; it is inherent to running the fill
 * on the client rather than shipping pixels.
 */

export function floodFill(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  startX: number,
  startY: number,
  hexColor: string,
  tolerance: number,
): void {
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  const fill = hexToRgb(hexColor);
  const start = (y0 * width + x0) * 4;
  const target = [data[start]!, data[start + 1]!, data[start + 2]!, data[start + 3]!] as const;

  // Already this colour: bail out rather than repainting the whole region.
  if (colorDistance(target, fill) === 0 && target[3] === 255) return;

  const tol2 = tolerance * tolerance;
  const matches = (offset: number): boolean => {
    const dr = data[offset]! - target[0];
    const dg = data[offset + 1]! - target[1];
    const db = data[offset + 2]! - target[2];
    const da = data[offset + 3]! - target[3];
    return dr * dr + dg * dg + db * db + da * da <= tol2;
  };

  // Explicit stack of scanline seeds. A per-pixel recursive fill would blow the
  // stack on a 1200x800 canvas.
  const stack: number[] = [x0, y0];
  const seen = new Uint8Array(width * height);

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const rowStart = y * width;
    if (seen[rowStart + x]) continue;

    let left = x;
    while (left > 0 && !seen[rowStart + left - 1] && matches((rowStart + left - 1) * 4)) left--;

    let right = x;
    while (right < width - 1 && !seen[rowStart + right + 1] && matches((rowStart + right + 1) * 4)) right++;

    if (!matches((rowStart + x) * 4)) continue;

    let spanAbove = false;
    let spanBelow = false;

    for (let i = left; i <= right; i++) {
      const idx = rowStart + i;
      seen[idx] = 1;
      const o = idx * 4;
      data[o] = fill[0];
      data[o + 1] = fill[1];
      data[o + 2] = fill[2];
      data[o + 3] = 255;

      if (y > 0) {
        const upIdx = idx - width;
        const up = !seen[upIdx] && matches(upIdx * 4);
        if (up && !spanAbove) {
          stack.push(i, y - 1);
          spanAbove = true;
        } else if (!up) {
          spanAbove = false;
        }
      }

      if (y < height - 1) {
        const downIdx = idx + width;
        const down = !seen[downIdx] && matches(downIdx * 4);
        if (down && !spanBelow) {
          stack.push(i, y + 1);
          spanBelow = true;
        } else if (!down) {
          spanBelow = false;
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
}

function colorDistance(a: readonly [number, number, number, number], b: readonly [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16) || 0,
    Number.parseInt(clean.slice(2, 4), 16) || 0,
    Number.parseInt(clean.slice(4, 6), 16) || 0,
  ];
}
