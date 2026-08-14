import { DEFAULT_ELIGIBILITY_RULES, EligibilityInput, checkEligibility } from './eligibility';

/** A student who passes every check; individual tests break one thing at a time. */
const eligibleStudent = (overrides: Partial<EligibilityInput> = {}): EligibilityInput => ({
  level: 'm4',
  gradeLevelCode: 'm4',
  enrollmentStatus: 'active',
  studentStatus: 'active',
  attendanceRate: 95,
  subjectsFailed: 0,
  hasProvisionalResult: false,
  hasNoResult: false,
  ...overrides,
});

describe('checkEligibility', () => {
  it('passes a student who meets every requirement', () => {
    const outcome = checkEligibility(eligibleStudent());
    expect(outcome.isEligible).toBe(true);
    expect(outcome.failedChecks).toEqual([]);
  });

  it('blocks a student whose record is not active', () => {
    const outcome = checkEligibility(eligibleStudent({ studentStatus: 'dropped' }));
    expect(outcome.isEligible).toBe(false);
    expect(outcome.failedChecks).toContain('student_not_active');
  });

  it('blocks a student with no active enrollment', () => {
    const outcome = checkEligibility(eligibleStudent({ enrollmentStatus: 'none' }));
    expect(outcome.failedChecks).toContain('not_enrolled');
  });

  it('blocks an m4 student from the m7 exam', () => {
    // The exam belongs to a grade level; sitting the wrong one is meaningless.
    const outcome = checkEligibility(eligibleStudent({ level: 'm7', gradeLevelCode: 'm4' }));
    expect(outcome.failedChecks).toContain('wrong_grade_level');
  });

  it('allows an m7 student to sit the m7 exam', () => {
    const outcome = checkEligibility(eligibleStudent({ level: 'm7', gradeLevelCode: 'm7' }));
    expect(outcome.isEligible).toBe(true);
  });

  it('blocks attendance below the minimum', () => {
    const outcome = checkEligibility(eligibleStudent({ attendanceRate: 79.9 }));
    expect(outcome.failedChecks).toContain('attendance_below_minimum');
  });

  it('treats the attendance threshold as inclusive', () => {
    // A student on exactly 80% must not be excluded by a rounding decision.
    const outcome = checkEligibility(eligibleStudent({ attendanceRate: 80 }));
    expect(outcome.failedChecks).not.toContain('attendance_below_minimum');
  });

  it('allows up to the permitted number of failed subjects', () => {
    expect(checkEligibility(eligibleStudent({ subjectsFailed: 2 })).isEligible).toBe(true);
    expect(checkEligibility(eligibleStudent({ subjectsFailed: 3 })).failedChecks).toContain(
      'too_many_failed_subjects',
    );
  });

  it('blocks a student with no computed term result', () => {
    const outcome = checkEligibility(eligibleStudent({ hasNoResult: true }));
    expect(outcome.failedChecks).toContain('no_term_result');
  });

  it('does not also report failed subjects when there is no result at all', () => {
    // Reporting both would be contradictory — you cannot have failed subjects in
    // a result that does not exist.
    const outcome = checkEligibility(eligibleStudent({ hasNoResult: true, subjectsFailed: 5 }));
    expect(outcome.failedChecks).toContain('no_term_result');
    expect(outcome.failedChecks).not.toContain('too_many_failed_subjects');
  });

  it('blocks a provisional result', () => {
    // Provisional marks come from incomplete scores and can still change, so they
    // cannot support a decision about graduation.
    const outcome = checkEligibility(eligibleStudent({ hasProvisionalResult: true }));
    expect(outcome.isEligible).toBe(false);
    expect(outcome.failedChecks).toContain('provisional_result');
  });

  it('reports every failing check, not just the first', () => {
    const outcome = checkEligibility(
      eligibleStudent({
        studentStatus: 'suspended',
        attendanceRate: 50,
        subjectsFailed: 4,
      }),
    );

    expect(outcome.failedChecks).toEqual(
      expect.arrayContaining([
        'student_not_active',
        'attendance_below_minimum',
        'too_many_failed_subjects',
      ]),
    );
  });

  it('honours custom rules', () => {
    const strict = {
      ...DEFAULT_ELIGIBILITY_RULES,
      minAttendanceRate: 95,
      maxSubjectsFailed: 0,
    };

    const student = eligibleStudent({ attendanceRate: 90, subjectsFailed: 1 });
    expect(checkEligibility(student).isEligible).toBe(true);

    const strictOutcome = checkEligibility(student, strict);
    expect(strictOutcome.isEligible).toBe(false);
    expect(strictOutcome.failedChecks).toEqual(
      expect.arrayContaining(['attendance_below_minimum', 'too_many_failed_subjects']),
    );
  });

  it('records the inputs and the rules applied in the snapshot', () => {
    // The snapshot is what makes an old decision explainable after the rules
    // change, so it must carry both sides.
    const outcome = checkEligibility(eligibleStudent({ attendanceRate: 88 }));

    expect(outcome.snapshot).toMatchObject({
      level: 'm4',
      attendanceRate: 88,
      isEligible: true,
      rulesApplied: DEFAULT_ELIGIBILITY_RULES,
    });
  });

  it('leaves checkedAt for the caller to stamp', () => {
    // The pure function has no clock, which is what keeps it testable.
    expect(checkEligibility(eligibleStudent()).snapshot.checkedAt).toBeNull();
  });
});
