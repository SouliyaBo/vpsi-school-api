/**
 * Where everything on the answer sheet is, in points on an A4 page.
 *
 * One table for two readers: the printer draws each bubble where this says,
 * and the scanner looks for ink where this says. Nothing here depends on
 * text — a longer title or a longer name must never move a bubble, or the
 * sheet printed in September would not be the sheet read in October.
 *
 * Only the counts vary: questions, options per question, digits in the
 * pupil's code, sets on the paper.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SheetBlock {
  /** Top-left of the block's fiducial square. */
  origin: Point;
  /** Centre line of the lettered header row. */
  headY: number;
  /** 1-based question numbers in this block, in order. */
  numbers: number[];
}

export interface AnswerSheetLayout {
  page: { width: number; height: number };
  fiducialSize: number;
  /** Centres of the four corner squares: top-left, top-right, bottom-left, bottom-right. */
  corners: [Point, Point, Point, Point];
  bubbleRadius: number;
  pitch: number;
  code: {
    digits: number;
    /** Top of the row of written-digit boxes. */
    boxesTop: number;
    left: number;
    /** Centre of the bubble for `digit` in column `column`. */
    bubble: (column: number, digit: number) => Point;
  };
  sets: {
    left: number;
    /** From the first column's left edge to the last column's bubble, plus padding. */
    width: number;
    count: number;
    /** Centre of the bubble for set `index`. */
    bubble: (index: number) => Point;
  };
  optionCount: number;
  questionCount: number;
  blocks: SheetBlock[];
  /** Centres of the option bubbles of 1-based question `number`, or null if it did not fit. */
  question: (number: number) => Point[] | null;
  /** The question's number label position (right edge, centre line). */
  questionLabel: (number: number) => Point | null;
  /** How many questions the page holds before it runs out of room. */
  capacity: number;
  qr: { x: number; y: number; size: number };
  particularsTop: number;
  instructionsTop: number;
}

export const PAGE = { width: 595.28, height: 841.89 };
export const MARGIN = { top: 48, bottom: 52, left: 54, right: 54 };
export const FIDUCIAL = 13;
export const BUBBLE_R = 4.6;
export const PITCH = 14.5;
export const QUESTIONS_PER_BLOCK = 12;
export const BLOCKS_PER_COLUMN = 2;
export const MIN_CODE_DIGITS = 4;
/** Sets stack beside the ten code rows; an eleventh starts a new column. */
export const SETS_PER_COLUMN = 10;
/** A column of set bubbles plus room for the next column's letters. */
export const SET_COLUMN_STEP = PITCH + 10;

const CODE_GRID_TOP = 95;
const PARTICULARS_TOP = 122;
const INSTRUCTIONS_TOP = 240;
const BLOCKS_TOP = 302;
const BLOCK_COLUMN_GAP = 90;
/** Big enough that a phone photo of the page gives each module several pixels. */
const QR_SIZE = 64;

export function answerSheetLayout(input: {
  questionCount: number;
  optionCount: number;
  codeDigits: number;
  setCount: number;
}): AnswerSheetLayout {
  const optionCount = Math.max(2, Math.min(8, input.optionCount));
  const codeDigits = Math.max(MIN_CODE_DIGITS, input.codeDigits);
  const left = MARGIN.left;
  const right = PAGE.width - MARGIN.right;
  const top = MARGIN.top;
  const bottom = PAGE.height - MARGIN.bottom;
  const half = FIDUCIAL / 2;

  const corners: [Point, Point, Point, Point] = [
    { x: left + half, y: top + half },
    { x: right - half, y: top + half },
    { x: left + half, y: bottom - half },
    { x: right - half, y: bottom - half },
  ];

  const gridRight = right - FIDUCIAL - 6;
  // Up to ten sets this is the single column every sheet printed so far has.
  const setColumns = Math.max(1, Math.ceil(input.setCount / SETS_PER_COLUMN));
  const setWidth = PITCH + 4 + (setColumns - 1) * SET_COLUMN_STEP;
  const setLeft = gridRight - setWidth;
  const codeWidth = codeDigits * PITCH;
  const codeLeft = setLeft - 16 - codeWidth;

  const blockWidth = 20 + optionCount * PITCH;
  const blockHeight = (QUESTIONS_PER_BLOCK + 1) * PITCH + FIDUCIAL + 6;
  const boxLeft = left + FIDUCIAL + 6;
  const usable = right - FIDUCIAL - boxLeft;
  const columnsThatFit = Math.max(
    1,
    Math.floor((usable + BLOCK_COLUMN_GAP) / (blockWidth + BLOCK_COLUMN_GAP)),
  );
  const rowsThatFit = Math.max(1, Math.floor((bottom - FIDUCIAL - 18 - BLOCKS_TOP) / blockHeight));
  const rowsPerColumn = Math.min(BLOCKS_PER_COLUMN, rowsThatFit);
  const capacity = columnsThatFit * rowsPerColumn * QUESTIONS_PER_BLOCK;

  const blockCount = Math.min(
    Math.ceil(input.questionCount / QUESTIONS_PER_BLOCK),
    columnsThatFit * rowsPerColumn,
  );
  const blocks: SheetBlock[] = [];
  for (let block = 0; block < blockCount; block += 1) {
    const column = Math.floor(block / rowsPerColumn);
    const row = block % rowsPerColumn;
    const origin = {
      x: boxLeft + column * (blockWidth + BLOCK_COLUMN_GAP),
      y: BLOCKS_TOP + row * blockHeight,
    };
    const headY = origin.y + FIDUCIAL + 4 + BUBBLE_R;
    const numbers: number[] = [];
    for (let q = 0; q < QUESTIONS_PER_BLOCK; q += 1) {
      const number = block * QUESTIONS_PER_BLOCK + q + 1;
      if (number > input.questionCount) break;
      numbers.push(number);
    }
    blocks.push({ origin, headY, numbers });
  }

  const optionX = (origin: Point, index: number) => origin.x + 20 + index * PITCH + PITCH / 2;
  const rowY = (block: SheetBlock, indexInBlock: number) =>
    block.headY + (indexInBlock + 1) * PITCH;

  const locate = (number: number) => {
    const block = blocks[Math.floor((number - 1) / QUESTIONS_PER_BLOCK)];
    if (!block || number < 1 || number > input.questionCount) return null;
    const indexInBlock = (number - 1) % QUESTIONS_PER_BLOCK;
    return { block, y: rowY(block, indexInBlock) };
  };

  return {
    page: { ...PAGE },
    fiducialSize: FIDUCIAL,
    corners,
    bubbleRadius: BUBBLE_R,
    pitch: PITCH,
    code: {
      digits: codeDigits,
      boxesTop: CODE_GRID_TOP - 18,
      left: codeLeft,
      bubble: (column, digit) => ({
        x: codeLeft + column * PITCH + PITCH / 2,
        y: CODE_GRID_TOP + digit * PITCH + BUBBLE_R,
      }),
    },
    sets: {
      left: setLeft,
      width: setWidth,
      count: input.setCount,
      bubble: (index) => ({
        x: setLeft + Math.floor(index / SETS_PER_COLUMN) * SET_COLUMN_STEP + PITCH / 2,
        y: CODE_GRID_TOP + (index % SETS_PER_COLUMN) * PITCH + BUBBLE_R,
      }),
    },
    optionCount,
    questionCount: input.questionCount,
    blocks,
    question: (number) => {
      const found = locate(number);
      if (!found) return null;
      return Array.from({ length: optionCount }, (_, i) => ({
        x: optionX(found.block.origin, i),
        y: found.y,
      }));
    },
    questionLabel: (number) => {
      const found = locate(number);
      return found ? { x: found.block.origin.x + 18, y: found.y } : null;
    },
    capacity,
    qr: {
      x: right - FIDUCIAL - 6 - QR_SIZE,
      y: bottom - FIDUCIAL - 2 - QR_SIZE - 4,
      size: QR_SIZE,
    },
    particularsTop: PARTICULARS_TOP,
    instructionsTop: INSTRUCTIONS_TOP,
  };
}

/** What the QR on a sheet says, and how it is read back. */
export const QR_PREFIX = 'vpsi-exam';

export function qrText(paperId: string, set: string | null, studentId: string | null): string {
  return [QR_PREFIX, paperId, set ?? '', studentId ?? ''].join(':');
}

export function parseQrText(
  text: string,
): { paperId: string; set: string | null; studentId: string | null } | null {
  const parts = text.split(':');
  if (parts.length !== 4 || parts[0] !== QR_PREFIX || !parts[1]) return null;
  return { paperId: parts[1], set: parts[2] || null, studentId: parts[3] || null };
}
