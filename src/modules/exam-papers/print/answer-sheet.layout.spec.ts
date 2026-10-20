import QRCode from 'qrcode';
import {
  answerSheetLayout,
  BUBBLE_R,
  parseQrText,
  qrText,
  SETS_PER_COLUMN,
} from './answer-sheet.layout';
import { MAX_VARIANTS } from '../variants';

const layoutFor = (setCount: number) =>
  answerSheetLayout({ questionCount: 40, optionCount: 4, codeDigits: 4, setCount });

describe('answer sheet set bubbles', () => {
  it('keeps the single column every sheet printed so far was read with', () => {
    const before = layoutFor(8);
    for (let i = 0; i < 8; i += 1) {
      expect(before.sets.bubble(i).x).toBe(before.sets.bubble(0).x);
    }
    expect(layoutFor(SETS_PER_COLUMN).code.left).toBe(before.code.left);
  });

  it('wraps 25 sets into columns that stay beside the code grid', () => {
    const layout = layoutFor(MAX_VARIANTS);
    const bubbles = Array.from({ length: MAX_VARIANTS }, (_, i) => layout.sets.bubble(i));
    const lowestCode = layout.code.bubble(0, 9).y;
    const rightEdge = layout.corners[1].x - layout.fiducialSize / 2;

    for (const b of bubbles) {
      expect(b.y).toBeLessThanOrEqual(lowestCode);
      expect(b.x + BUBBLE_R).toBeLessThan(rightEdge);
      expect(b.x - BUBBLE_R).toBeGreaterThan(layout.code.bubble(layout.code.digits - 1, 0).x);
    }
    // No two bubbles share a spot.
    const spots = new Set(bubbles.map((b) => `${b.x},${b.y}`));
    expect(spots.size).toBe(MAX_VARIANTS);
  });
});

describe('the QR', () => {
  const PAPER = '66f1a2b3c4d5e6f7a8b9c0d1';
  const STUDENT = '66f1a2b3c4d5e6f7a8b9c0d2';

  it('carries the ຮອບ and reads back as the ids the database holds', () => {
    const text = qrText(PAPER, 'L', STUDENT, '7F3K');
    expect(text).toBe(`VPSI-EXAM:${PAPER.toUpperCase()}:L:${STUDENT.toUpperCase()}:7F3K`);
    expect(parseQrText(text)).toEqual({
      paperId: PAPER,
      set: 'L',
      studentId: STUDENT,
      stamp: '7F3K',
    });
  });

  it('still reads a sheet printed before the ຮອບ, which has none', () => {
    expect(parseQrText(`vpsi-exam:${PAPER}:C:${STUDENT}`)).toEqual({
      paperId: PAPER,
      set: 'C',
      studentId: STUDENT,
      stamp: null,
    });
    expect(parseQrText(`vpsi-exam:${PAPER}::`)).toEqual({
      paperId: PAPER,
      set: null,
      studentId: null,
      stamp: null,
    });
  });

  it('stays the same QR size as before the ຮອບ was added', () => {
    // Upper case packs it in alphanumeric mode: still version 4, so the
    // modules a phone has to resolve are no finer than on older sheets.
    const named = QRCode.create(qrText(PAPER, 'Y', STUDENT, 'ZZZZ'), { errorCorrectionLevel: 'M' });
    expect(named.version).toBeLessThanOrEqual(4);
  });
});
