import { ExamLevel } from 'src/common/constants/enums';

/**
 * Whether a student may sit a national exam.
 *
 * Kept as a pure function so the rules are unit-testable and reviewable in one
 * place — eligibility decides whether a student gets to graduate, so it is the
 * last thing that should be buried inside a service method.
 */
export interface EligibilityInput {
  level: ExamLevel;
  /** Grade level the student is enrolled in, e.g. `m4`. */
  gradeLevelCode: string;
  enrollmentStatus: string;
  studentStatus: string;
  /** Percentage of recorded sessions attended, 0–100. */
  attendanceRate: number;
  /** Subjects failed in the most recent computed term result. */
  subjectsFailed: number;
  /** True when the term result was computed from incomplete scores. */
  hasProvisionalResult: boolean;
  /** No term result computed at all. */
  hasNoResult: boolean;
}

export interface EligibilityRules {
  minAttendanceRate: number;
  maxSubjectsFailed: number;
  /** Which grade level each exam belongs to. */
  requiredGradeLevel: Record<ExamLevel, string>;
}

export const DEFAULT_ELIGIBILITY_RULES: EligibilityRules = {
  minAttendanceRate: 80,
  maxSubjectsFailed: 2,
  requiredGradeLevel: { m4: 'm4', m7: 'm7' },
};

export interface EligibilityOutcome {
  isEligible: boolean;
  /** Machine-readable reasons, so the client can localize them. */
  failedChecks: EligibilityFailure[];
  /** Snapshot stored on the registration, per docs/schema-design.md. */
  snapshot: Record<string, unknown>;
}

export type EligibilityFailure =
  | 'student_not_active'
  | 'not_enrolled'
  | 'wrong_grade_level'
  | 'attendance_below_minimum'
  | 'too_many_failed_subjects'
  | 'no_term_result'
  | 'provisional_result';

export function checkEligibility(
  input: EligibilityInput,
  rules: EligibilityRules = DEFAULT_ELIGIBILITY_RULES,
): EligibilityOutcome {
  const failedChecks: EligibilityFailure[] = [];

  if (input.studentStatus !== 'active') failedChecks.push('student_not_active');
  if (input.enrollmentStatus !== 'active') failedChecks.push('not_enrolled');

  // The exam belongs to a specific grade level; an m4 student cannot sit m7.
  if (input.gradeLevelCode !== rules.requiredGradeLevel[input.level]) {
    failedChecks.push('wrong_grade_level');
  }

  if (input.attendanceRate < rules.minAttendanceRate) {
    failedChecks.push('attendance_below_minimum');
  }

  if (input.hasNoResult) {
    failedChecks.push('no_term_result');
  } else {
    // A provisional result cannot support an eligibility decision — the marks
    // it is based on are still incomplete and may change.
    if (input.hasProvisionalResult) failedChecks.push('provisional_result');
    if (input.subjectsFailed > rules.maxSubjectsFailed) {
      failedChecks.push('too_many_failed_subjects');
    }
  }

  return {
    isEligible: failedChecks.length === 0,
    failedChecks,
    snapshot: {
      checkedAt: null, // stamped by the caller, which owns the clock
      level: input.level,
      gradeLevelCode: input.gradeLevelCode,
      studentStatus: input.studentStatus,
      enrollmentStatus: input.enrollmentStatus,
      attendanceRate: input.attendanceRate,
      subjectsFailed: input.subjectsFailed,
      hasProvisionalResult: input.hasProvisionalResult,
      hasNoResult: input.hasNoResult,
      rulesApplied: rules,
      failedChecks,
      isEligible: failedChecks.length === 0,
    },
  };
}
