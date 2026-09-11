import { ConductGrade, Grade } from 'src/common/constants/enums';

/**
 * Bump this whenever the formulas below change.
 *
 * Stored on each `termResults` document as `computationVersion`, so a historical
 * result can always be traced to the rules that produced it. Without it, a
 * change to the grade boundaries would silently make old records unexplainable.
 */
export const COMPUTATION_VERSION = 3;
// 2 — the term average became an equal-weight mean over the subjects the grade
//     sits, replacing the credit-weighted mean. See `computeTermResult`.
// 3 — the grade scale became the school's own A–F, with an E and no `+` bands.

export interface GradeBand {
  grade: Grade;
  /** Inclusive lower bound as a percentage of the maximum. */
  minPercentage: number;
  gradePoint: number;
}

/**
 * The school's grade scale, overridable through the `grading.scale` setting.
 *
 * Given by the office as marks out of 10 and held here as percentages, which is
 * the same scale times ten — every mark in this system is a 0–100 figure, and
 * screens divide by `grading.reportMarkScale` to show it back out of 10:
 *
 *   A 8.5–10 · B 7–8.4 · C 5.5–6.9 · D 4.5–5.4 · E 3.5–4.4 · F 0–3.4
 *
 * The bands the office wrote leave a hairline gap between them (8.4 to 8.5), so
 * the thresholds are read as lower bounds and `gradeFor` takes the first band
 * that is met: 8.45 is a B, not a nothing.
 *
 * `gradePoint` is not the school's — they do not keep a GPA — and only orders
 * the bands for the figure the system already carries. E at 0.5 keeps it above
 * F without claiming a pass.
 *
 * Ordered high to low; `gradeFor` returns the first band whose threshold is met.
 */
export const DEFAULT_GRADE_SCALE: readonly GradeBand[] = [
  { grade: 'A', minPercentage: 85, gradePoint: 4.0 },
  { grade: 'B', minPercentage: 70, gradePoint: 3.0 },
  { grade: 'C', minPercentage: 55, gradePoint: 2.0 },
  { grade: 'D', minPercentage: 45, gradePoint: 1.0 },
  { grade: 'E', minPercentage: 35, gradePoint: 0.5 },
  { grade: 'F', minPercentage: 0, gradePoint: 0 },
];

export const DEFAULT_PASSING_PERCENTAGE = 50;

export interface ComponentInput {
  componentId: string;
  nameLo: string;
  /** Null when not yet graded — distinct from a score of zero. */
  score: number | null;
  maxScore: number;
  /** Percentage of the subject mark this component carries. */
  weight: number;
  /** An absence scores zero rather than leaving the subject incomplete. */
  isAbsent?: boolean;
}

export interface ComponentResult extends ComponentInput {
  /** The component's contribution to the subject's 0–100 mark. */
  weightedScore: number;
}

export interface SubjectComputation {
  components: ComponentResult[];
  percentage: number;
  grade: Grade;
  gradePoint: number;
  isPassed: boolean;
  isIncomplete: boolean;
}

/** Rounds to two decimals, avoiding the float artefacts of naive arithmetic. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function gradeFor(
  percentage: number,
  scale: readonly GradeBand[] = DEFAULT_GRADE_SCALE,
): GradeBand {
  const band = scale.find((b) => percentage >= b.minPercentage);
  // The scale always ends at 0, so this fallback is unreachable in practice —
  // it exists so a misconfigured custom scale degrades to F rather than crashing.
  return band ?? { grade: 'F', minPercentage: 0, gradePoint: 0 };
}

/**
 * Computes one subject's outcome from its component scores.
 *
 * The weighted mark is `Σ (score / maxScore × weight)`, giving a 0–100 figure
 * when the weights total 100.
 *
 * **Ungraded components are excluded and the result is flagged incomplete**,
 * rather than counted as zero. Treating a not-yet-marked exam as zero would
 * show a passing student as failing mid-term. To keep a partial result
 * meaningful, the mark is rescaled over the weight actually recorded so far —
 * so a student with 18/20 on the only graded component (weight 20) shows 90%,
 * not 18%.
 *
 * An absence is different: it is a recorded outcome of zero, so it counts.
 */
export function computeSubjectResult(
  components: ComponentInput[],
  options: {
    scale?: readonly GradeBand[];
    passingPercentage?: number;
  } = {},
): SubjectComputation {
  const scale = options.scale ?? DEFAULT_GRADE_SCALE;
  const passingPercentage = options.passingPercentage ?? DEFAULT_PASSING_PERCENTAGE;

  const results: ComponentResult[] = components.map((component) => {
    const isGraded = component.score !== null || component.isAbsent === true;
    const effectiveScore = component.isAbsent ? 0 : (component.score ?? 0);
    const ratio = component.maxScore > 0 ? effectiveScore / component.maxScore : 0;

    return {
      ...component,
      weightedScore: isGraded ? round2(ratio * component.weight) : 0,
    };
  });

  const gradedComponents = components.filter((c) => c.score !== null || c.isAbsent === true);
  const isIncomplete = gradedComponents.length < components.length;

  const recordedWeight = gradedComponents.reduce((sum, c) => sum + c.weight, 0);
  const earned = results.reduce((sum, r) => sum + r.weightedScore, 0);

  // Rescale over the weight recorded so far; with everything graded and weights
  // totalling 100 this is exactly `earned`.
  const percentage = recordedWeight > 0 ? round2((earned / recordedWeight) * 100) : 0;

  const band = gradeFor(percentage, scale);

  return {
    components: results,
    percentage,
    grade: band.grade,
    gradePoint: band.gradePoint,
    isPassed: percentage >= passingPercentage,
    isIncomplete,
  };
}

/**
 * The 10-point monthly sheet expressed in the same terms as a weighted subject.
 *
 * `ພາກຮຽນ` is already the whole story for a subject marked on the school's own
 * form — there are no components left to weigh — so this is a translation rather
 * than a computation: a mark of 8.31 out of 10 is 83.1 out of 100, and the grade,
 * the grade point and the pass are read off the same scale every other subject
 * uses. Keeping one canonical percentage is what lets a class be ranked and a GPA
 * be taken across subjects marked either way.
 *
 * A subject still waiting on a month or on the exam has no mark yet. It comes back
 * as zero *and* incomplete — never as a fail — which is what holds the whole term
 * result back from publication.
 */
export function computeSubjectFromMark(
  mark: number | null,
  isComplete: boolean,
  options: { scale?: readonly GradeBand[]; passingPercentage?: number; markMax?: number } = {},
): Omit<SubjectComputation, 'components'> {
  const scale = options.scale ?? DEFAULT_GRADE_SCALE;
  const passingPercentage = options.passingPercentage ?? DEFAULT_PASSING_PERCENTAGE;
  const markMax = options.markMax ?? 10;

  const percentage = mark === null || markMax <= 0 ? 0 : round2((mark / markMax) * 100);
  const band = gradeFor(percentage, scale);

  return {
    percentage,
    grade: band.grade,
    gradePoint: band.gradePoint,
    isPassed: mark !== null && percentage >= passingPercentage,
    isIncomplete: !isComplete || mark === null,
  };
}

export interface SubjectSummary {
  credits: number;
  percentage: number;
  gradePoint: number;
  isPassed: boolean;
}

export interface TermComputation {
  average: number;
  gpa: number;
  grade: Grade;
  subjectsPassed: number;
  subjectsFailed: number;
  /** How many subjects the grade is marked in — the divisor the school uses. */
  subjectsExpected: number;
  /** How many of them this student has a mark in. */
  subjectsRecorded: number;
}

export interface TermOptions {
  scale?: readonly GradeBand[];
  /**
   * The number of subjects this grade is marked in, when it is known.
   *
   * Defaults to the number of subjects handed in, which is right only once every
   * one of them is marked.
   */
  expectedSubjects?: number;
}

/**
 * Aggregates subject results into a term outcome.
 *
 * **Every subject counts once, and the divisor is the number of subjects the
 * grade is marked in** — the school's rule, in its own words: add the subject
 * marks up and divide by 8 at ມ.4 and ມ.7, by 7 at ມ.5 and ມ.6, by 4 at ມ.1–ມ.3.
 * `credits` is not a weight here; it stays on the subject as the ໜ່ວຍກິດ the
 * report card prints.
 *
 * This was a credit-weighted mean, which is a different number: with ພາສາລາວ and
 * ຄະນິດສາດ at 4 credits against ສັງຄົມ and ທຳມະຊາດ at 3, a mark of 8 in maths and
 * 5 in ສັງຄົມ came out at 6.71 rather than the 6.5 the school's own sheet gives.
 *
 * Dividing by the expected count rather than by what has been entered is
 * deliberate: a student marked in five of eight subjects reads low and is flagged
 * provisional, which is a visible gap. Averaging the five would read as a
 * finished result three subjects short.
 */
export function computeTermResult(
  subjects: SubjectSummary[],
  options: TermOptions = {},
): TermComputation {
  const { scale = DEFAULT_GRADE_SCALE, expectedSubjects } = options;
  const divisor = Math.max(expectedSubjects ?? subjects.length, subjects.length);

  if (divisor === 0) {
    return {
      average: 0,
      gpa: 0,
      grade: 'F',
      subjectsPassed: 0,
      subjectsFailed: 0,
      subjectsExpected: 0,
      subjectsRecorded: 0,
    };
  }

  const average = round2(subjects.reduce((sum, s) => sum + s.percentage, 0) / divisor);
  const gpa = round2(subjects.reduce((sum, s) => sum + s.gradePoint, 0) / divisor);

  return {
    average,
    gpa,
    grade: gradeFor(average, scale).grade,
    subjectsPassed: subjects.filter((s) => s.isPassed).length,
    subjectsFailed: subjects.filter((s) => !s.isPassed).length,
    subjectsExpected: divisor,
    subjectsRecorded: subjects.length,
  };
}

export interface Rankable {
  studentId: string;
  average: number;
}

/**
 * Assigns class ranks using **competition ranking**: equal averages share a
 * rank and the next rank skips accordingly (1, 2, 2, 4). Two students with the
 * same mark must not be ordered arbitrarily.
 */
export function assignRanks(entries: Rankable[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.average - a.average);
  const ranks = new Map<string, number>();

  let currentRank = 0;
  let previousAverage: number | null = null;

  sorted.forEach((entry, index) => {
    if (previousAverage === null || entry.average !== previousAverage) {
      currentRank = index + 1;
      previousAverage = entry.average;
    }
    ranks.set(entry.studentId, currentRank);
  });

  return ranks;
}

/** Conduct bands, mirroring the academic scale. */
export const CONDUCT_BANDS: readonly { grade: ConductGrade; minScore: number }[] = [
  { grade: 'excellent', minScore: 90 },
  { grade: 'very_good', minScore: 80 },
  { grade: 'good', minScore: 70 },
  { grade: 'fair', minScore: 60 },
  { grade: 'poor', minScore: 0 },
];

export function conductGradeFor(score: number): ConductGrade {
  return CONDUCT_BANDS.find((b) => score >= b.minScore)?.grade ?? 'poor';
}
