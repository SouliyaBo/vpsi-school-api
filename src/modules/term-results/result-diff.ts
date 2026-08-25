import type { ConductGrade, Grade } from 'src/common/constants/enums';

/**
 * Whether a recomputed term result says anything different from the stored one.
 *
 * The question this answers is not "did any byte change" but "would a family read
 * a different report card". That is what decides whether a published result has to
 * be withdrawn and published again, so the comparison is deliberately limited to
 * the figures a report card actually carries about achievement:
 *
 *  - the marks themselves, per subject and in aggregate;
 *  - whether each subject was passed, and how many were;
 *  - the conduct grade and the class rank, both of which are printed;
 *  - whether the result is still provisional.
 *
 * Attendance is **not** compared. It is on the card, but it moves with every
 * corrected roll call — flagging a term result for withdrawal because a Tuesday
 * absence was reclassified would train the office to publish through the warning,
 * which is worse than not warning at all. Marks are what publication is about.
 */
export interface ComparableSubject {
  subjectId: string;
  percentage: number;
  grade: Grade | string;
  isPassed: boolean;
  isIncomplete: boolean;
}

export interface ComparableResult {
  average: number;
  gpa: number;
  grade: Grade | string;
  subjectsPassed: number;
  subjectsFailed: number;
  conductGrade: ConductGrade | string | null;
  isProvisional: boolean;
  /** `null` before the class has been ranked. */
  rank?: number | null;
  subjects: ComparableSubject[];
}

export function resultsDiffer(before: ComparableResult, after: ComparableResult): boolean {
  if (
    before.average !== after.average ||
    before.gpa !== after.gpa ||
    before.grade !== after.grade ||
    before.subjectsPassed !== after.subjectsPassed ||
    before.subjectsFailed !== after.subjectsFailed ||
    (before.conductGrade ?? null) !== (after.conductGrade ?? null) ||
    before.isProvisional !== after.isProvisional ||
    (before.rank ?? null) !== (after.rank ?? null)
  ) {
    return true;
  }

  if (before.subjects.length !== after.subjects.length) return true;

  // Compared by subject rather than by position: a subject added or dropped
  // reorders the list, and a report card that gained a row is a different card.
  const previous = new Map(before.subjects.map((subject) => [subject.subjectId, subject]));
  return after.subjects.some((subject) => {
    const was = previous.get(subject.subjectId);
    return (
      !was ||
      was.percentage !== subject.percentage ||
      was.grade !== subject.grade ||
      was.isPassed !== subject.isPassed ||
      was.isIncomplete !== subject.isIncomplete
    );
  });
}
