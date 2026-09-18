import { answerFor, Variant } from './variants';

/**
 * Marking a filled answer sheet against the key.
 *
 * Pure, like the shuffle: the sheet is a list of letters by printed position,
 * the key is derivable from the variant, and the two meet here and nowhere
 * else — so the answer key the teacher printed and the mark the system gives
 * cannot disagree.
 */

export interface GradedQuestion {
  /** Printed position on the set, 0-based. */
  position: number;
  /** Index into the paper's own question list. */
  original: number;
  /** Letter index marked, or `null` for a blank. */
  marked: number | null;
  /** Letter index of the right answer on this set, or `null` if the paper has none. */
  correct: number | null;
  /** `null` when the question has no answer on record — it counts for nobody. */
  isCorrect: boolean | null;
}

export interface GradeResult {
  correctCount: number;
  /** Questions with an answer on record — what the mark is out of. */
  totalQuestions: number;
  points: number | null;
  questions: GradedQuestion[];
}

export function gradeSheet(
  variant: Variant,
  correctIndexes: (number | null | undefined)[],
  answers: (number | null | undefined)[],
  totalPoints: number | null | undefined,
): GradeResult {
  const questions = variant.questionOrder.map((original, position): GradedQuestion => {
    const correct = answerFor(variant, position, correctIndexes[original] ?? null);
    const marked = answers[position] ?? null;
    return {
      position,
      original,
      marked,
      correct,
      isCorrect: correct === null ? null : marked === correct,
    };
  });
  const gradable = questions.filter((question) => question.isCorrect !== null);
  const correctCount = gradable.filter((question) => question.isCorrect).length;
  const totalQuestions = gradable.length;
  const points =
    totalPoints === null || totalPoints === undefined || totalQuestions === 0
      ? null
      : Math.round((correctCount / totalQuestions) * totalPoints * 100) / 100;
  return { correctCount, totalQuestions, points, questions };
}

/**
 * `"BCDA-B"` → `[1, 2, 3, 0, null, 1]` — the letters a teacher types off a
 * sheet, one per printed question, `-` (or a space, or `.`) for a blank.
 * Lao letters are read in their own order.
 */
export function parseAnswerString(
  text: string,
  letters: readonly string[],
  count: number,
): (number | null)[] {
  const upper = [...text.trim().toUpperCase()].filter((ch) => !/\s/.test(ch));
  const answers: (number | null)[] = [];
  for (let i = 0; i < count; i += 1) {
    const ch = upper[i];
    if (ch === undefined) {
      answers.push(null);
      continue;
    }
    const index = letters.findIndex((letter) => letter.toUpperCase() === ch);
    answers.push(index >= 0 ? index : null);
  }
  return answers;
}
