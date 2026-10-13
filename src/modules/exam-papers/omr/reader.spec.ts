import QRCode from 'qrcode';
import sharp from 'sharp';
import { answerSheetLayout, qrText } from '../print/answer-sheet.layout';
import { readAnswerSheet } from './reader';

/**
 * No real photographs yet, so the sheet is drawn from the layout — the
 * same table the printer uses — then photographed badly on purpose: tilted,
 * blurred, dimmed, upside down, with a corner of desk in frame. What is
 * asserted is what a teacher would check by eye: the right bubbles, the
 * pupil's code, the set, the QR, and that a double mark reads as none.
 */

const layout = answerSheetLayout({ questionCount: 40, optionCount: 4, codeDigits: 4, setCount: 4 });
const PAPER_ID = '66f1a2b3c4d5e6f7a8b9c0d1';
const STUDENT_ID = '66f1a2b3c4d5e6f7a8b9c0d2';

interface Filled {
  /** question number → letter indexes filled */
  answers: Record<number, number[]>;
  /** faint marks: question → index */
  faint?: Record<number, number>;
  code: string;
  set: number;
}

/** The sheet as SVG at 1pt = 1 user unit. */
/** `blockDrift` moves every block — square and bubbles together — off where the layout says. */
function sheetSvg(filled: Filled, blockDrift = { x: 0, y: 0 }, sheet = layout): string {
  const parts: string[] = [];
  const f = sheet.fiducialSize;
  for (const c of sheet.corners) {
    parts.push(
      `<rect x="${c.x - f / 2}" y="${c.y - f / 2}" width="${f}" height="${f}" fill="#000"/>`,
    );
  }
  for (const block of sheet.blocks) {
    parts.push(
      `<rect x="${block.origin.x + blockDrift.x}" y="${block.origin.y + blockDrift.y}" width="${f}" height="${f}" fill="#000"/>`,
    );
  }
  const ring = (x: number, y: number, fill = 'none', opacity = 1) =>
    `<circle cx="${x}" cy="${y}" r="${sheet.bubbleRadius}" fill="${fill}" fill-opacity="${opacity}" stroke="#333" stroke-width="0.7"/>`;
  for (let q = 1; q <= sheet.questionCount; q += 1) {
    const centres = sheet.question(q)!;
    centres.forEach((c, i) => {
      const dark = filled.answers[q]?.includes(i);
      const faint = filled.faint?.[q] === i;
      parts.push(
        ring(
          c.x + blockDrift.x,
          c.y + blockDrift.y,
          dark || faint ? '#000' : 'none',
          faint ? 0.42 : 1,
        ),
      );
    });
    const label = sheet.questionLabel(q)!;
    parts.push(
      `<text x="${label.x + blockDrift.x}" y="${label.y + blockDrift.y + 3}" font-size="8" text-anchor="end" font-family="sans-serif">${q}</text>`,
    );
  }
  for (let d = 0; d < sheet.code.digits; d += 1) {
    for (let digit = 0; digit < 10; digit += 1) {
      const c = sheet.code.bubble(d, digit);
      parts.push(ring(c.x, c.y, Number(filled.code[d]) === digit ? '#000' : 'none'));
    }
  }
  for (let i = 0; i < sheet.sets.count; i += 1) {
    const c = sheet.sets.bubble(i);
    parts.push(ring(c.x, c.y, filled.set === i ? '#000' : 'none'));
  }
  // Some text in the header, like the real sheet, so the reader is not
  // tested on a page that is cleaner than any it will meet.
  parts.push(
    `<text x="140" y="80" font-size="12" font-family="sans-serif">ANSWER SHEET · sample paper</text>`,
  );
  parts.push(
    `<rect x="160" y="${sheet.particularsTop}" width="220" height="110" fill="none" stroke="#000" stroke-width="0.8"/>`,
  );
  const qr = QRCode.create(qrText(PAPER_ID, 'C', STUDENT_ID), { errorCorrectionLevel: 'M' });
  const cell = sheet.qr.size / qr.modules.size;
  for (let r = 0; r < qr.modules.size; r += 1) {
    for (let c = 0; c < qr.modules.size; c += 1) {
      if (qr.modules.get(r, c)) {
        parts.push(
          `<rect x="${sheet.qr.x + c * cell}" y="${sheet.qr.y + r * cell}" width="${cell}" height="${cell}" fill="#000"/>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.page.width}" height="${sheet.page.height}" viewBox="0 0 ${sheet.page.width} ${sheet.page.height}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;
}

/** Rasterise at `scale` px/pt and mistreat the result like a phone would. */
async function photograph(
  svg: string,
  options: { scale?: number; rotate?: number; blur?: number; dim?: number; desk?: boolean } = {},
): Promise<Buffer> {
  const scale = options.scale ?? 2.6;
  let image = sharp(Buffer.from(svg), { density: 72 * scale }).flatten({ background: '#fff' });
  if (options.desk) {
    // A dark desk around the page, as when the page does not fill the frame.
    image = image.extend({ top: 60, bottom: 90, left: 40, right: 70, background: '#4a3b2f' });
  }
  if (options.rotate) image = image.rotate(options.rotate, { background: '#4a3b2f' });
  if (options.blur) image = image.blur(options.blur);
  if (options.dim) image = image.linear(options.dim, 0);
  return image.jpeg({ quality: 80 }).toBuffer();
}

const FILLED: Filled = {
  answers: {
    1: [1],
    2: [2],
    3: [3],
    4: [0],
    5: [1, 3],
    12: [2],
    13: [0],
    24: [3],
    25: [1],
    40: [2],
  },
  faint: { 7: 2 },
  code: '0807',
  set: 2,
};

describe('readAnswerSheet', () => {
  it('reads a straight, clean photograph', async () => {
    const { result } = await readAnswerSheet(await photograph(sheetSvg(FILLED)), layout);
    if (!result.ok) throw new Error(result.reason);

    const marked = Object.fromEntries(result.questions.map((q) => [q.number, q.marked]));
    expect(marked[1]).toBe(1);
    expect(marked[2]).toBe(2);
    expect(marked[3]).toBe(3);
    expect(marked[4]).toBe(0);
    expect(marked[12]).toBe(2);
    expect(marked[13]).toBe(0);
    expect(marked[24]).toBe(3);
    expect(marked[25]).toBe(1);
    expect(marked[40]).toBe(2);
    expect(marked[6]).toBeNull();
    expect(result.questions[5].flag).toBe('blank');
    // Two bubbles filled is no answer, and says so.
    expect(marked[5]).toBeNull();
    expect(result.questions[4].flag).toBe('double');
    // A half-hearted mark is read but flagged for the teacher.
    expect(marked[7]).toBe(2);
    expect(result.questions[6].flag).toBe('faint');

    expect(result.codeFromBubbles).toBe('0807');
    expect(result.setFromBubbles).toBe(2);
    expect(result.qr).toEqual({ paperId: PAPER_ID, set: 'C', studentId: STUDENT_ID });
  }, 30000);

  it('reads the set from a sheet whose 25 sets run to three columns', async () => {
    const wide = answerSheetLayout({
      questionCount: 40,
      optionCount: 4,
      codeDigits: 4,
      setCount: 25,
    });
    const photo = await photograph(sheetSvg({ ...FILLED, set: 22 }, undefined, wide), {
      rotate: 3,
      blur: 0.6,
    });
    const { result } = await readAnswerSheet(photo, wide);
    if (!result.ok) throw new Error(result.reason);

    expect(result.setFromBubbles).toBe(22);
    expect(result.codeFromBubbles).toBe('0807');
    expect(result.questions[0].marked).toBe(1);
  }, 30000);

  it('reads a tilted, blurred, dim photograph with desk in frame', async () => {
    const photo = await photograph(sheetSvg(FILLED), {
      scale: 2.2,
      rotate: 4,
      blur: 1.1,
      dim: 0.72,
      desk: true,
    });
    const { result } = await readAnswerSheet(photo, layout);
    if (!result.ok) throw new Error(result.reason);

    const marked = Object.fromEntries(result.questions.map((q) => [q.number, q.marked]));
    expect([marked[1], marked[2], marked[3], marked[4], marked[40]]).toEqual([1, 2, 3, 0, 2]);
    expect(marked[5]).toBeNull();
    expect(result.questions.filter((q) => q.flag === 'ok')).toHaveLength(9);
    expect(result.codeFromBubbles).toBe('0807');
    expect(result.setFromBubbles).toBe(2);
    expect(result.qr?.studentId).toBe(STUDENT_ID);
  }, 30000);

  it('reads a photograph tilted a quarter turn short of sideways', async () => {
    const photo = await photograph(sheetSvg(FILLED), { rotate: 25, desk: true, scale: 2.0 });
    const { result } = await readAnswerSheet(photo, layout);
    if (!result.ok) throw new Error(result.reason);
    const marked = Object.fromEntries(result.questions.map((q) => [q.number, q.marked]));
    expect([marked[1], marked[13], marked[25], marked[40]]).toEqual([1, 0, 1, 2]);
    expect(result.codeFromBubbles).toBe('0807');
    expect(result.qr?.set).toBe('C');
  }, 30000);

  it('follows the block squares when the blocks are not where the corners say', async () => {
    // Ten points up and three across — the drift of a sheet printed from an
    // earlier layout, and about what a phone lens does to the middle of a page.
    const photo = await photograph(sheetSvg(FILLED, { x: 3, y: -10 }), { rotate: 3, desk: true });
    const { result } = await readAnswerSheet(photo, layout);
    if (!result.ok) throw new Error(result.reason);
    const marked = Object.fromEntries(result.questions.map((q) => [q.number, q.marked]));
    expect([
      marked[1],
      marked[2],
      marked[3],
      marked[4],
      marked[12],
      marked[13],
      marked[24],
      marked[25],
      marked[40],
    ]).toEqual([1, 2, 3, 0, 2, 0, 3, 1, 2]);
    expect(marked[5]).toBeNull();
    expect(result.questions.filter((q) => q.flag === 'faint' || q.flag === 'double')).toHaveLength(
      2,
    );
  }, 30000);

  it('reads a photograph taken upside down', async () => {
    const photo = await photograph(sheetSvg(FILLED), { rotate: 180, desk: true });
    const { result } = await readAnswerSheet(photo, layout);
    if (!result.ok) throw new Error(result.reason);
    const marked = Object.fromEntries(result.questions.map((q) => [q.number, q.marked]));
    expect([marked[1], marked[13], marked[25], marked[40]]).toEqual([1, 0, 1, 2]);
    expect(result.codeFromBubbles).toBe('0807');
  }, 30000);

  it('says so when the corners cannot be found, and when the file is not a picture', async () => {
    const blank = await sharp({
      create: { width: 800, height: 1100, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const { result } = await readAnswerSheet(blank, layout);
    expect(result).toMatchObject({ ok: false, reason: 'cornersNotFound' });

    const junk = await readAnswerSheet(Buffer.from('not a picture'), layout);
    expect(junk.result).toMatchObject({ ok: false, reason: 'notAnImage' });
  }, 30000);
});
