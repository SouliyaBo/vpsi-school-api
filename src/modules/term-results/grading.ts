import { ConductGrade, Grade } from 'src/common/constants/enums';

/**
 * Bump this whenever the formulas below change.
 *
 * Stored on each `termResults` document as `computationVersion`, so a historical
 * result can always be traced to the rules that produced it. Without it, a
 * change to the grade boundaries would silently make old records unexplainable.
 */
export const COMPUTATION_VERSION = 1;

export interface GradeBand {
  grade: Grade;
  /** Inclusive lower bound as a percentage of the maximum. */
  minPercentage: number;
  gradePoint: number;
}

/**
 * Default grade scale, overridable through the `grading.scale` setting.
 *
 * Ordered high to low; `gradeFor` returns the first band whose threshold is met.
 */
export const DEFAULT_GRADE_SCALE: readonly GradeBand[] = [
  { grade: 'A', minPercentage: 80, gradePoint: 4.0 },
  { grade: 'B+', minPercentage: 75, gradePoint: 3.5 },
  { grade: 'B', minPercentage: 70, gradePoint: 3.0 },
  { grade: 'C+', minPercentage: 65, gradePoint: 2.5 },
  { grade: 'C', minPercentage: 60, gradePoint: 2.0 },
  { grade: 'D+', minPercentage: 55, gradePoint: 1.5 },
  { grade: 'D', minPercentage: 50, gradePoint: 1.0 },
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
}

/**
 * Aggregates subject results into a term outcome.
 *
 * Both the average and the GPA are **credit-weighted**: a 4-credit subject moves
 * the average twice as much as a 2-credit one. An unweighted mean would let a
 * minor elective offset a core subject.
 */
export function computeTermResult(
  subjects: SubjectSummary[],
  scale: readonly GradeBand[] = DEFAULT_GRADE_SCALE,
): TermComputation {
  if (subjects.length === 0) {
    return { average: 0, gpa: 0, grade: 'F', subjectsPassed: 0, subjectsFailed: 0 };
  }

  const totalCredits = subjects.reduce((sum, s) => sum + s.credits, 0);

  // Guard against every subject carrying zero credits, which would divide by zero.
  const weight = (subject: SubjectSummary) => (totalCredits > 0 ? subject.credits : 1);
  const divisor = totalCredits > 0 ? totalCredits : subjects.length;

  const average = round2(subjects.reduce((sum, s) => sum + s.percentage * weight(s), 0) / divisor);
  const gpa = round2(subjects.reduce((sum, s) => sum + s.gradePoint * weight(s), 0) / divisor);

  return {
    average,
    gpa,
    grade: gradeFor(average, scale).grade,
    subjectsPassed: subjects.filter((s) => s.isPassed).length,
    subjectsFailed: subjects.filter((s) => !s.isPassed).length,
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
