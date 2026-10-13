/**
 * Drawing the sets, and seating them.
 *
 * Pure functions over plain arrays so they can be asserted without a database:
 * the whole value of the module is that two neighbours' papers differ, and
 * that is a property of these functions, not of the screens around them.
 */

export const VARIANT_LABELS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
] as const;
export const MAX_VARIANTS = VARIANT_LABELS.length;

export interface VariantSource {
  /** The part the question sits under; shuffling never crosses a part. */
  section: string | null;
  optionCount: number;
  lockOptions: boolean;
}

export interface Variant {
  label: string;
  questionOrder: number[];
  optionOrders: number[][];
}

/**
 * A small deterministic generator (mulberry32).
 *
 * `Math.random` would do for the shuffle itself, but the seed is what lets a
 * paper edited after its sets were made be re-drawn to the *same* sets — and
 * what makes the answer key reproducible from the record alone.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new drawing — 31 bits so it survives JSON and Mongo untouched. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isIdentity(order: readonly number[]): boolean {
  return order.every((value, index) => value === index);
}

function sameOrder(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Draws `count` sets from the questions.
 *
 * Questions are shuffled within their part and the parts keep their order —
 * a paper that puts ten easy questions before ten hard ones stays that way.
 * Options are shuffled per question unless the question is locked or
 * `shuffleOptions` is off.
 *
 * Two sets with the same question order would defeat the purpose, and so
 * would a set in the teacher's own order (their file is the one the class has
 * seen if any has leaked), so each drawing is retried until it is distinct
 * from the original and from every earlier set — a paper of two questions
 * has only one non-identity order, and after enough tries the duplicate is
 * accepted rather than looping forever.
 */
export function drawVariants(
  questions: readonly VariantSource[],
  options: { count: number; shuffleOptions: boolean; seed: number },
): Variant[] {
  const count = Math.max(1, Math.min(MAX_VARIANTS, options.count));
  const random = seededRandom(options.seed);
  const groups = partGroups(questions);
  const variants: Variant[] = [];

  for (let v = 0; v < count; v += 1) {
    let questionOrder: number[] = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      questionOrder = groups.flatMap((group) => shuffled(group, random));
      const distinct =
        (questions.length < 2 || !isIdentity(questionOrder)) &&
        variants.every((earlier) => !sameOrder(earlier.questionOrder, questionOrder));
      if (distinct) break;
    }

    const optionOrders = questionOrder.map((questionIndex) => {
      const question = questions[questionIndex];
      const identity = Array.from({ length: question.optionCount }, (_, i) => i);
      if (!options.shuffleOptions || question.lockOptions || question.optionCount < 2) {
        return identity;
      }
      let order = shuffled(identity, random);
      // With two or more options there is always a non-identity order; one
      // retry is plenty in practice and the loop is bounded regardless.
      for (let attempt = 0; attempt < 10 && isIdentity(order); attempt += 1) {
        order = shuffled(identity, random);
      }
      return order;
    });

    variants.push({ label: VARIANT_LABELS[v], questionOrder, optionOrders });
  }

  return variants;
}

/** Indexes of the questions, grouped by consecutive runs of the same part. */
function partGroups(questions: readonly VariantSource[]): number[][] {
  const groups: number[][] = [];
  let currentSection: string | null | undefined;
  questions.forEach((question, index) => {
    if (groups.length === 0 || question.section !== currentSection) {
      groups.push([]);
      currentSection = question.section;
    }
    groups[groups.length - 1].push(index);
  });
  return groups;
}

/**
 * Which letter the option printed at `printedIndex` of `printedPosition` in
 * a set is the right one — the answer key, derived rather than stored.
 */
export function answerFor(
  variant: Variant,
  printedPosition: number,
  correctIndex: number | null,
): number | null {
  if (correctIndex === null || correctIndex === undefined) return null;
  const printed = variant.optionOrders[printedPosition].indexOf(correctIndex);
  return printed >= 0 ? printed : null;
}

// ── Seating ─────────────────────────────────────────────────────────────────

/**
 * The set for the pupil in seat (`row`, `column`) of a room seated `columns`
 * across, so that no two pupils side by side or one behind the other hold the
 * same set.
 *
 * Each row is the label cycle shifted by half the number of sets from the row
 * above. For four sets that is
 *
 *     A B C D A B
 *     C D A B C D
 *     A B C D A B
 *
 * — left/right always differ because the cycle has no repeats, front/back
 * always differ because a shift of ⌈n/2⌉ is never a whole cycle, and with an
 * even number of sets the diagonals differ too. With two sets it is a
 * chessboard, which is the best two sets can do.
 */
export function setForSeat(row: number, column: number, setCount: number): number {
  if (setCount <= 1) return 0;
  const shift = Math.ceil(setCount / 2);
  return (column + row * shift) % setCount;
}

export interface SeatedStudent<T> {
  student: T;
  row: number;
  column: number;
  /** Index into the labels — `0` is set A. */
  setIndex: number;
}

/**
 * Seats a class roll in reading order — front row left to right, then the
 * next row — and hands each seat its set. The roll is in the order the class
 * actually sits, which for this school is the roll number.
 */
export function seatClass<T>(
  roll: readonly T[],
  columns: number,
  setCount: number,
): SeatedStudent<T>[] {
  const across = Math.max(1, columns);
  return roll.map((student, index) => {
    const row = Math.floor(index / across);
    const column = index % across;
    return { student, row, column, setIndex: setForSeat(row, column, setCount) };
  });
}
