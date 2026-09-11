import { resultsDiffer, type ComparableResult } from './result-diff';

const subject = (overrides: Partial<ComparableResult['subjects'][number]> = {}) => ({
  subjectId: 'sub-1',
  percentage: 83.1,
  grade: 'A',
  isPassed: true,
  isIncomplete: false,
  ...overrides,
});

const result = (overrides: Partial<ComparableResult> = {}): ComparableResult => ({
  average: 83.1,
  gpa: 4,
  grade: 'A',
  subjectsPassed: 1,
  subjectsFailed: 0,
  conductGrade: 'very_good',
  isProvisional: false,
  rank: 1,
  subjects: [subject()],
  ...overrides,
});

describe('resultsDiffer', () => {
  it('sees no difference in a recomputation that changed nothing', () => {
    // The everyday case: the office reruns the class after correcting one
    // student, and everyone else's published result must stay published.
    expect(resultsDiffer(result(), result())).toBe(false);
  });

  it.each([
    ['the average', { average: 82 }],
    ['the GPA', { gpa: 3.5 }],
    ['the overall grade', { grade: 'B' }],
    ['how many subjects were passed', { subjectsPassed: 0, subjectsFailed: 1 }],
    ['the conduct grade', { conductGrade: 'good' }],
    ['the class rank', { rank: 2 }],
    ['whether it is still provisional', { isProvisional: true }],
  ])('sees a difference when %s moves', (_label, change) => {
    expect(resultsDiffer(result(), result(change))).toBe(true);
  });

  it('sees a subject mark move even when the totals happen to match', () => {
    const before = result({ subjects: [subject({ percentage: 83.1 })] });
    const after = result({ subjects: [subject({ percentage: 78 })] });
    expect(resultsDiffer(before, after)).toBe(true);
  });

  it('sees a subject that has been added or dropped', () => {
    const before = result();
    const after = result({ subjects: [subject(), subject({ subjectId: 'sub-2' })] });
    expect(resultsDiffer(before, after)).toBe(true);
    expect(resultsDiffer(after, before)).toBe(true);
  });

  it('compares subjects by id, not by the order they came back in', () => {
    const before = result({ subjects: [subject(), subject({ subjectId: 'sub-2' })] });
    const after = result({ subjects: [subject({ subjectId: 'sub-2' }), subject()] });
    expect(resultsDiffer(before, after)).toBe(false);
  });

  it('sees a subject that is no longer waiting on a mark', () => {
    // Same percentage, but it is final now — the card stops saying provisional.
    const before = result({ subjects: [subject({ isIncomplete: true })] });
    expect(resultsDiffer(before, result())).toBe(true);
  });

  it('ignores attendance, which moves with every corrected roll call', () => {
    // Not part of ComparableResult at all: a warning that fires on a Tuesday
    // absence being reclassified is a warning the office learns to publish
    // through.
    const withAttendance = { ...result(), daysAbsent: 3 } as ComparableResult;
    expect(resultsDiffer(result(), withAttendance)).toBe(false);
  });

  it('treats a missing conduct grade and an explicit null as the same', () => {
    const before = result({ conductGrade: null });
    const after = { ...result(), conductGrade: undefined } as unknown as ComparableResult;
    expect(resultsDiffer(before, after)).toBe(false);
  });
});
