import { adaptiveThreshold, Blob, findBlobs, GrayImage, sampleGray } from './image';
import { applyHomography, distance, Point, signedArea, solveHomography } from './geometry';
import { AnswerSheetLayout } from '../print/answer-sheet.layout';

/**
 * Finds the four corner squares and, from them, the page.
 *
 * A corner square is the one kind of mark on the sheet that is solid,
 * square and this size: bubbles are round, digits are thin, the QR's finder
 * patterns are rings, and the pen only ever fills a circle. So: threshold,
 * take the solid square-ish blobs of about the right size, and the four
 * that reach furthest into the photo's corners are the corners. Whether the
 * page is upside down is settled afterwards by looking for the block
 * squares where each orientation says they should be.
 */

export interface PageFix {
  /** Page (pt) → photo (px). */
  toPhoto: (p: Point) => Point;
  /** The corner squares' centres in the photo — top-left, top-right, bottom-left, bottom-right. */
  corners: [Point, Point, Point, Point];
  /** Every solid square found, corners included — the block squares are among them. */
  squares: Blob[];
  /** Area of a corner square in the photo, to recognise its siblings by. */
  squareArea: number;
}

export function findPage(image: GrayImage, layout: AnswerSheetLayout): PageFix | null {
  const window = Math.max(15, Math.round(Math.min(image.width, image.height) / 20)) | 1;
  const binary = adaptiveThreshold(image, window, 20);
  const blobs = findBlobs(binary, image.width, image.height, 25);

  const solid = blobs.filter((blob) => isSolidSquare(blob, image));
  if (solid.length < 4) return null;
  // A filled bubble is solid too, but has two-fifths of a square's area;
  // the squares are the largest solid marks on the page, and there are at
  // least four of them. Measured by area, not by box, so a tilt changes nothing.
  const areas = solid.map((blob) => blob.area).sort((a, b) => b - a);
  const reference = areas[Math.min(3, areas.length - 1)];
  const squares = solid.filter((blob) => blob.area >= reference * 0.6);
  if (squares.length < 4) return null;
  const squareArea = reference;

  const candidates: [Point, Point, Point, Point] = [
    extreme(squares, (b) => -(b.cx + b.cy)),
    extreme(squares, (b) => b.cx - b.cy),
    extreme(squares, (b) => b.cy - b.cx),
    extreme(squares, (b) => b.cx + b.cy),
  ];
  if (new Set(candidates.map((p) => `${p.x},${p.y}`)).size < 4) return null;

  // Try the four ways of naming the corners; keep the one whose page shape
  // is right and whose block squares are darkest where they should be.
  let best: { fix: PageFix; score: number } | null = null;
  for (const order of ORIENTATIONS) {
    const corners = order.map((i) => candidates[i]) as [Point, Point, Point, Point];
    if (!plausibleShape(corners, layout)) continue;
    const h = solveHomography([...layout.corners], corners);
    const toPhoto = (p: Point) => applyHomography(h, p);
    const score = layout.blocks.reduce((sum, block) => {
      const centre = toPhoto({
        x: block.origin.x + layout.fiducialSize / 2,
        y: block.origin.y + layout.fiducialSize / 2,
      });
      return sum + (255 - sampleGray(image, centre.x, centre.y));
    }, 0);
    if (!best || score > best.score) {
      best = { fix: { toPhoto, corners, squares, squareArea }, score };
    }
  }
  return best?.fix ?? null;
}

/** Index orders of [TL, TR, BL, BR] for 0°, 180°, 90° and 270°. */
const ORIENTATIONS = [
  [0, 1, 2, 3],
  [3, 2, 1, 0],
  [2, 0, 3, 1],
  [1, 3, 0, 2],
];

/**
 * Solid and about as wide as high. The box of a square tilted by θ is
 * (cos θ + sin θ)² larger than the square, so the fill is allowed down to
 * 0.55 — a tilt of nearly 30° — and it is the area test above, not this,
 * that keeps the bubbles out.
 */
function isSolidSquare(blob: Blob, image: GrayImage): boolean {
  const w = blob.maxX - blob.minX + 1;
  const h = blob.maxY - blob.minY + 1;
  const aspect = w / h;
  if (aspect < 0.7 || aspect > 1.45) return false;
  if (blob.area / (w * h) < 0.55) return false;
  // Between 0.8 % and 5 % of the photo's width: the squares are 2.2 % of the
  // page, and the page fills most of a photograph of it.
  const share = w / image.width;
  return share > 0.008 && share < 0.05;
}

function extreme(blobs: Blob[], score: (blob: Blob) => number): Point {
  let bestBlob = blobs[0];
  let bestScore = -Infinity;
  for (const blob of blobs) {
    const s = score(blob);
    if (s > bestScore) {
      bestScore = s;
      bestBlob = blob;
    }
  }
  return { x: bestBlob.cx, y: bestBlob.cy };
}

/** Convex, roughly the page's proportions, and not degenerate. */
function plausibleShape(corners: [Point, Point, Point, Point], layout: AnswerSheetLayout): boolean {
  const [tl, tr, bl, br] = corners;
  const topW = distance(tl, tr);
  const bottomW = distance(bl, br);
  const leftH = distance(tl, bl);
  const rightH = distance(tr, br);
  if (Math.min(topW, bottomW, leftH, rightH) < 50) return false;
  const expected =
    (layout.corners[1].x - layout.corners[0].x) / (layout.corners[2].y - layout.corners[0].y);
  const observed = (topW + bottomW) / (leftH + rightH);
  if (observed < expected * 0.7 || observed > expected * 1.4) return false;
  // The quadrilateral tl → tr → br → bl must not fold over itself.
  const area = signedArea([tl, tr, br, bl]);
  return Math.abs(area) > 0.5 * topW * leftH;
}
