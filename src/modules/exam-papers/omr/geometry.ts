/**
 * The little linear algebra a flat sheet photographed at an angle needs.
 *
 * A photograph of a page is the page under a projective transform. Four
 * known points — the corner squares — fix that transform, and once it is
 * fixed every bubble's position on the page says where it is in the photo.
 */

export interface Point {
  x: number;
  y: number;
}

/** A 3×3 matrix, row-major. */
export type Homography = number[];

/**
 * The homography taking each `from[i]` to `to[i]` (four pairs, no three
 * collinear) — the direct linear transform, eight unknowns, solved exactly.
 */
export function solveHomography(from: Point[], to: Point[]): Homography {
  if (from.length !== 4 || to.length !== 4) throw new Error('four point pairs are needed');
  const rows: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solve(rows);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting on an 8×9 augmented system. */
function solve(rows: number[][]): number[] {
  const n = 8;
  const a = rows.map((row) => [...row]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('degenerate point set');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed area — positive for one winding, negative for the other. */
export function signedArea(quad: Point[]): number {
  let sum = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
