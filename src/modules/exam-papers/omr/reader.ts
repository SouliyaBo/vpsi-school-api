import jsQR from 'jsqr';
import { AnswerSheetLayout, parseQrText } from '../print/answer-sheet.layout';
import { findPage, PageFix } from './corners';
import { AnswerSheetLayout as Layout } from '../print/answer-sheet.layout';
import { Point } from './geometry';
import { GrayImage, preparePhoto, sampleGray } from './image';

/**
 * Reads one photographed answer sheet.
 *
 * The thresholds are relative, not absolute: paper is whatever most bubbles
 * look like in this photograph, ink is whatever the corner squares look
 * like, and a bubble is "filled" by where it sits between the two. A
 * photograph taken in a dim classroom and one taken by a window read the
 * same way.
 *
 * Every judgement carries its evidence — the darkness of each bubble and
 * where it was looked for — so the review page can show the teacher the
 * photo with the reader's eyes drawn on it, and let them overrule it.
 */

export type MarkFlag = 'ok' | 'blank' | 'faint' | 'double';

export interface ReadQuestion {
  number: number;
  /** Letter index chosen, or `null` for blank and for a double mark. */
  marked: number | null;
  flag: MarkFlag;
  /** 0 = paper, 1 = ink, one per option. */
  darkness: number[];
  /** Where each option's bubble is in the photo. */
  centres: Point[];
}

export interface SheetReading {
  ok: true;
  image: { width: number; height: number };
  corners: [Point, Point, Point, Point];
  qr: { paperId: string; set: string | null; studentId: string | null } | null;
  /** The code read from the digit columns, or null if any column was undecidable. */
  codeFromBubbles: string | null;
  codeCentres: Point[][];
  setFromBubbles: number | null;
  setCentres: Point[];
  questions: ReadQuestion[];
  /** How far apart paper and ink were — low means a poor photograph. */
  contrast: number;
}

export interface SheetReadFailure {
  ok: false;
  reason: 'notAnImage' | 'cornersNotFound' | 'lowContrast';
  image?: { width: number; height: number };
}

export type SheetReadResult = SheetReading | SheetReadFailure;

/** Above this a bubble is filled; below `FAINT` it is blank; between, faint. */
const FILLED = 0.5;
const FAINT = 0.28;
/** A second bubble this dark is a second answer, which is no answer. */
const DOUBLE = 0.4;
const MIN_CONTRAST = 40;

export async function readAnswerSheet(
  photo: Buffer,
  layout: AnswerSheetLayout,
): Promise<{ result: SheetReadResult; jpeg: Buffer | null }> {
  let prepared;
  try {
    prepared = await preparePhoto(photo);
  } catch {
    return { result: { ok: false, reason: 'notAnImage' }, jpeg: null };
  }
  const { gray, jpeg } = prepared;
  const size = { width: gray.width, height: gray.height };

  const page = findPage(gray, layout);
  if (!page) return { result: { ok: false, reason: 'cornersNotFound', image: size }, jpeg };

  const ink = mean(page.corners.map((c) => sampleGray(gray, c.x, c.y)));
  const scale = pixelsPerPoint(page, layout);
  const radiusPx = layout.bubbleRadius * 0.5 * scale;
  const snapPx = layout.pitch * 0.15 * scale;
  const shifts = blockShifts(page, layout, scale);
  const questionCentres = Array.from({ length: layout.questionCount }, (_, i) => {
    const shift = shifts[blockIndexOf(layout, i + 1)] ?? { x: 0, y: 0 };
    return (layout.question(i + 1) ?? []).map((p) => {
      const mapped = page.toPhoto(p);
      return { x: mapped.x + shift.x, y: mapped.y + shift.y };
    });
  });
  const rawByQuestion = questionCentres.map((centres) =>
    centres.map((centre) => bubbleGray(gray, centre, radiusPx, snapPx)),
  );
  const paper = median(rawByQuestion.flat());
  const contrast = paper - ink;
  if (!(contrast > MIN_CONTRAST)) {
    return { result: { ok: false, reason: 'lowContrast', image: size }, jpeg };
  }
  const darknessOf = (value: number) => Math.max(0, Math.min(1, (paper - value) / contrast));

  const questions: ReadQuestion[] = rawByQuestion.map((raw, i) => {
    const darkness = raw.map(darknessOf);
    return { number: i + 1, centres: questionCentres[i], darkness, ...judge(darkness) };
  });

  const codeCentres = Array.from({ length: layout.code.digits }, (_, column) =>
    Array.from({ length: 10 }, (_, digit) => page.toPhoto(layout.code.bubble(column, digit))),
  );
  const codeDigits = codeCentres.map((column) => {
    const darkness = column.map((centre) => darknessOf(bubbleGray(gray, centre, radiusPx, snapPx)));
    const verdict = judge(darkness);
    return verdict.flag === 'ok' ? verdict.marked : null;
  });
  const codeFromBubbles = codeDigits.every((d) => d !== null) ? codeDigits.join('') : null;

  const setCentres = Array.from({ length: layout.sets.count }, (_, i) =>
    page.toPhoto(layout.sets.bubble(i)),
  );
  const setVerdict = judge(
    setCentres.map((centre) => darknessOf(bubbleGray(gray, centre, radiusPx, snapPx))),
  );

  return {
    result: {
      ok: true,
      image: size,
      corners: page.corners,
      qr: readQr(gray, page, layout),
      codeFromBubbles,
      codeCentres,
      setFromBubbles: setVerdict.flag === 'ok' ? setVerdict.marked : null,
      setCentres,
      questions,
      contrast,
    },
    jpeg,
  };
}

/** The darkest bubble wins, unless a second one is dark too. */
function judge(darkness: number[]): { marked: number | null; flag: MarkFlag } {
  if (darkness.length === 0) return { marked: null, flag: 'blank' };
  const order = darkness.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]);
  const [first, index] = order[0];
  const second = order[1]?.[0] ?? 0;
  if (first < FAINT) return { marked: null, flag: 'blank' };
  if (second >= DOUBLE && first >= FAINT) return { marked: null, flag: 'double' };
  if (first < FILLED) return { marked: index, flag: 'faint' };
  return { marked: index, flag: 'ok' };
}

/**
 * Where each block really is, relative to where the corners say it should be.
 *
 * Four corners fix a flat page under a perfect lens; a phone's lens bows
 * the middle of the page, and a printer that scaled the sheet a little
 * moves everything the corners do not pin. Each block carries its own
 * square for exactly this: the nearest solid square to the block's
 * predicted square says how far the block has drifted, and its bubbles are
 * looked for there. A block whose square is hidden or smudged keeps the
 * corners' estimate.
 */
function blockShifts(page: PageFix, layout: Layout, scale: number): Point[] {
  const half = layout.fiducialSize / 2;
  const reach = layout.fiducialSize * 2.5 * scale;
  return layout.blocks.map((block) => {
    const predicted = page.toPhoto({ x: block.origin.x + half, y: block.origin.y + half });
    let best: { dx: number; dy: number; d: number } | null = null;
    for (const square of page.squares) {
      if (square.area < page.squareArea * 0.5 || square.area > page.squareArea * 2.2) continue;
      const dx = square.cx - predicted.x;
      const dy = square.cy - predicted.y;
      const d = Math.hypot(dx, dy);
      if (d <= reach && (!best || d < best.d)) best = { dx, dy, d };
    }
    return best ? { x: best.dx, y: best.dy } : { x: 0, y: 0 };
  });
}

function blockIndexOf(layout: Layout, number: number): number {
  return layout.blocks.findIndex((block) => block.numbers.includes(number));
}

/**
 * Mean grey inside the bubble — a small grid of samples within half the
 * radius, so the printed ring is never counted as ink — taken at the
 * predicted centre and a step in each direction, keeping the darkest. The
 * step is well under half a pitch, so a neighbour's ink is never reached,
 * while a bubble a hair off its predicted place is still read in full.
 */
function bubbleGray(gray: GrayImage, centre: Point, radiusPx: number, snapPx: number): number {
  let darkest = Infinity;
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      const value = discGray(
        gray,
        { x: centre.x + sx * snapPx, y: centre.y + sy * snapPx },
        radiusPx,
      );
      if (value < darkest) darkest = value;
    }
  }
  return darkest;
}

function discGray(gray: GrayImage, centre: Point, radiusPx: number): number {
  const offsets = [-1, -0.5, 0, 0.5, 1];
  const values: number[] = [];
  for (const dx of offsets) {
    for (const dy of offsets) {
      if (dx * dx + dy * dy > 1.01) continue;
      values.push(sampleGray(gray, centre.x + dx * radiusPx, centre.y + dy * radiusPx));
    }
  }
  return mean(values);
}

/** Photo pixels per page point, from the corner squares. */
function pixelsPerPoint(page: PageFix, layout: AnswerSheetLayout): number {
  const [tl, tr, bl] = page.corners;
  const pageW = layout.corners[1].x - layout.corners[0].x;
  const pageH = layout.corners[2].y - layout.corners[0].y;
  return (
    (Math.hypot(tr.x - tl.x, tr.y - tl.y) / pageW + Math.hypot(bl.x - tl.x, bl.y - tl.y) / pageH) /
    2
  );
}

/**
 * The QR, looked for where the sheet puts it — a crop around that spot,
 * enlarged, is both faster and surer than the whole photograph.
 */
function readQr(gray: GrayImage, page: PageFix, layout: AnswerSheetLayout) {
  const { x, y, size } = layout.qr;
  const pad = size * 0.5;
  const box = [
    page.toPhoto({ x: x - pad, y: y - pad }),
    page.toPhoto({ x: x + size + pad, y: y - pad }),
    page.toPhoto({ x: x - pad, y: y + size + pad }),
    page.toPhoto({ x: x + size + pad, y: y + size + pad }),
  ];
  const minX = Math.max(0, Math.floor(Math.min(...box.map((p) => p.x))));
  const maxX = Math.min(gray.width, Math.ceil(Math.max(...box.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...box.map((p) => p.y))));
  const maxY = Math.min(gray.height, Math.ceil(Math.max(...box.map((p) => p.y))));
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 20 || h < 20) return null;

  // jsQR wants RGBA. The crop is tried upscaled by nearest neighbour at a few
  // sizes, plain and then pushed to black-and-white: a small, softly
  // compressed QR that fails as grey often reads once its modules are crisp.
  const crop = new Uint8Array(w * h);
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      crop[py * w + px] = gray.data[(minY + py) * gray.width + (minX + px)];
    }
  }
  const sorted = [...crop].sort((a, b) => a - b);
  const threshold =
    (sorted[Math.floor(sorted.length * 0.2)] + sorted[Math.floor(sorted.length * 0.8)]) / 2;
  for (const binarize of [false, true]) {
    for (const factor of [Math.max(1, Math.ceil(240 / Math.min(w, h))), 3, 5]) {
      const cw = w * factor;
      const ch = h * factor;
      const rgba = new Uint8ClampedArray(cw * ch * 4);
      for (let py = 0; py < ch; py += 1) {
        for (let px = 0; px < cw; px += 1) {
          let v = crop[Math.floor(py / factor) * w + Math.floor(px / factor)];
          if (binarize) v = v < threshold ? 0 : 255;
          const o = (py * cw + px) * 4;
          rgba[o] = v;
          rgba[o + 1] = v;
          rgba[o + 2] = v;
          rgba[o + 3] = 255;
        }
      }
      const found = jsQR(rgba, cw, ch, { inversionAttempts: 'dontInvert' });
      const parsed = found ? parseQrText(found.data) : null;
      if (parsed) return parsed;
    }
  }
  return null;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
