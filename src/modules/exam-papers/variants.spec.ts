import { model } from 'mongoose';
import { ExamPaperSchema } from 'src/database/schemas/exam-paper.schema';
import {
  answerFor,
  drawVariants,
  MAX_VARIANTS,
  seatClass,
  seededRandom,
  setForSeat,
} from './variants';

const question = (optionCount = 4, section: string | null = null, lockOptions = false) => ({
  section,
  optionCount,
  lockOptions,
});

describe('drawVariants', () => {
  const twenty = Array.from({ length: 20 }, () => question());

  it('is a permutation per set, distinct from the original and from each other', () => {
    const variants = drawVariants(twenty, { count: 4, shuffleOptions: true, seed: 7 });

    expect(variants.map((v) => v.label)).toEqual(['A', 'B', 'C', 'D']);
    const identity = twenty.map((_, i) => i);
    const orders = variants.map((v) => v.questionOrder);
    for (const order of orders) {
      expect([...order].sort((a, b) => a - b)).toEqual(identity);
      expect(order).not.toEqual(identity);
    }
    expect(new Set(orders.map((o) => o.join(','))).size).toBe(4);
  });

  it('is reproducible from the seed', () => {
    const first = drawVariants(twenty, { count: 3, shuffleOptions: true, seed: 12345 });
    const again = drawVariants(twenty, { count: 3, shuffleOptions: true, seed: 12345 });
    const other = drawVariants(twenty, { count: 3, shuffleOptions: true, seed: 12346 });
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('shuffles options per question, but not a locked one, and not when told not to', () => {
    const questions = [question(4), question(4, null, true), question(4)];
    const [variant] = drawVariants(questions, { count: 1, shuffleOptions: true, seed: 3 });

    const lockedPosition = variant.questionOrder.indexOf(1);
    expect(variant.optionOrders[lockedPosition]).toEqual([0, 1, 2, 3]);
    variant.questionOrder.forEach((original, position) => {
      if (original === 1) return;
      expect(variant.optionOrders[position]).not.toEqual([0, 1, 2, 3]);
      expect([...variant.optionOrders[position]].sort()).toEqual([0, 1, 2, 3]);
    });

    const [plain] = drawVariants(questions, { count: 1, shuffleOptions: false, seed: 3 });
    expect(plain.optionOrders).toEqual([
      [0, 1, 2, 3],
      [0, 1, 2, 3],
      [0, 1, 2, 3],
    ]);
  });

  it('keeps every question inside its part, and the parts in order', () => {
    const questions = [
      ...Array.from({ length: 5 }, () => question(4, 'ພາກ I')),
      ...Array.from({ length: 5 }, () => question(4, 'ພາກ II')),
    ];
    const variants = drawVariants(questions, { count: 4, shuffleOptions: false, seed: 99 });
    for (const variant of variants) {
      expect(variant.questionOrder.slice(0, 5).every((i) => i < 5)).toBe(true);
      expect(variant.questionOrder.slice(5).every((i) => i >= 5)).toBe(true);
    }
  });

  it('caps the number of sets and copes with a paper too small to differ', () => {
    expect(drawVariants(twenty, { count: 99, shuffleOptions: false, seed: 1 })).toHaveLength(25);
    const tiny = drawVariants([question(2)], { count: 3, shuffleOptions: true, seed: 1 });
    expect(tiny).toHaveLength(3);
    expect(tiny.every((v) => v.questionOrder.length === 1)).toBe(true);
  });

  it('traces the printed letter of the right answer', () => {
    const variant = {
      label: 'A',
      questionOrder: [1, 0],
      optionOrders: [
        [2, 0, 1, 3],
        [0, 1, 2, 3],
      ],
    };
    // Question 1 is printed first; its original option 0 now sits at letter B.
    expect(answerFor(variant, 0, 0)).toBe(1);
    expect(answerFor(variant, 1, 3)).toBe(3);
    expect(answerFor(variant, 0, null)).toBeNull();
  });
});

describe('seededRandom', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('seating', () => {
  it('gives no two neighbours — beside or behind — the same set, for two to eight sets', () => {
    for (let sets = 2; sets <= 8; sets += 1) {
      for (let columns = 1; columns <= 8; columns += 1) {
        for (let row = 0; row < 12; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const here = setForSeat(row, column, sets);
            if (column + 1 < columns) {
              expect(here).not.toBe(setForSeat(row, column + 1, sets));
            }
            expect(here).not.toBe(setForSeat(row + 1, column, sets));
          }
        }
      }
    }
  });

  it('seats twelve pupils four across into four sets so each block of four differs', () => {
    const roll = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
    const seated = seatClass(roll, 4, 4);
    expect(seated.map((s) => s.setIndex)).toEqual([0, 1, 2, 3, 2, 3, 0, 1, 0, 1, 2, 3]);
    expect(seated[5]).toEqual({ student: 's6', row: 1, column: 1, setIndex: 3 });
  });

  it('is a single set when there is only one', () => {
    expect(seatClass(['a', 'b', 'c'], 2, 1).map((s) => s.setIndex)).toEqual([0, 0, 0]);
  });
});

describe('the stored set count', () => {
  it('lets the database hold as many sets as can be drawn', async () => {
    const ExamPaper = model('ExamPaperVariantCountCheck', ExamPaperSchema);
    const atMax = new ExamPaper({ variantCount: MAX_VARIANTS });
    expect(atMax.validateSync()?.errors.variantCount).toBeUndefined();
    const over = new ExamPaper({ variantCount: MAX_VARIANTS + 1 });
    expect(over.validateSync()?.errors.variantCount).toBeDefined();
  });
});
