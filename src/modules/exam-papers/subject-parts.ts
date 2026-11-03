import type { GradedQuestion } from './grading';

/**
 * ແຍກຄະແນນຕາມວິຊາ — one paper, several marked subjects.
 *
 * A ທຳມະຊາດ paper is written as one paper with a ພາກ each for ຟີຊິກ, ເຄມີ and
 * ຊີວະ, but the marks are kept against the three subjects apart (the office, 21
 * Oct 2026). The teacher says which ພາກ belongs to which subject, and what that
 * subject's part is out of; a pupil's points in a subject are then the share of
 * that subject's questions they got right, the same rule `gradeSheet` applies
 * to the paper as a whole.
 *
 * Worked out on read, from the sheet as marked — never stored on the sheet —
 * so a changed mapping or a corrected key can never leave a stale split behind.
 */

/** A question with no ພາກ heading is in the part named `''`. */
export const NO_SECTION = '';

export interface SubjectPart {
  subjectId: string;
  /** The ພາກ headings, exactly as on the questions; `''` for none. */
  sections: string[];
  /** What this subject's part is out of; `null` takes the paper's total. */
  points: number | null;
}

export interface SubjectScore {
  subjectId: string;
  correctCount: number;
  /** This subject's questions that have an answer on record. */
  totalQuestions: number;
  points: number | null;
}

export function sectionKey(section: string | null | undefined): string {
  return section ?? NO_SECTION;
}

/** Each ພາກ on the paper once, in the order it first appears, with its size. */
export function sectionsOf(
  questions: { section?: string | null }[],
): { section: string; questions: number }[] {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const key = sectionKey(question.section);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([section, count]) => ({ section, questions: count }));
}

/** What the part is out of: its own figure, or the paper's. */
export function partTotal(part: SubjectPart, paperTotal: number | null | undefined): number | null {
  return part.points ?? paperTotal ?? null;
}

/** Questions in no subject's part — they count towards no subject. */
export function unassignedCount(
  questions: { section?: string | null }[],
  parts: SubjectPart[],
): number {
  const assigned = new Set(parts.flatMap((part) => part.sections));
  return questions.filter((question) => !assigned.has(sectionKey(question.section))).length;
}

/**
 * Why a mapping cannot be kept, or `null`: a ພາກ given to two subjects, or one
 * subject listed twice, would make one question count twice.
 */
export function partsProblem(parts: SubjectPart[]): 'sectionTwice' | 'subjectTwice' | null {
  const subjects = new Set<string>();
  const sections = new Set<string>();
  for (const part of parts) {
    if (subjects.has(part.subjectId)) return 'subjectTwice';
    subjects.add(part.subjectId);
    for (const section of part.sections) {
      if (sections.has(section)) return 'sectionTwice';
      sections.add(section);
    }
  }
  return null;
}

/** One marked sheet's points per subject, in the order the parts are listed. */
export function scoreBySubject(
  questions: { section?: string | null }[],
  graded: GradedQuestion[],
  parts: SubjectPart[],
  paperTotal: number | null | undefined,
): SubjectScore[] {
  return parts.map((part) => {
    const sections = new Set(part.sections);
    const mine = graded.filter(
      (question) =>
        question.isCorrect !== null &&
        sections.has(sectionKey(questions[question.original]?.section)),
    );
    const correctCount = mine.filter((question) => question.isCorrect).length;
    const totalQuestions = mine.length;
    const total = partTotal(part, paperTotal);
    const points =
      total === null || totalQuestions === 0
        ? null
        : Math.round((correctCount / totalQuestions) * total * 100) / 100;
    return { subjectId: part.subjectId, correctCount, totalQuestions, points };
  });
}
