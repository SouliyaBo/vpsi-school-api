import {
  ComponentInput,
  computeSubjectFromMark,
  DEFAULT_GRADE_SCALE,
  GradeBand,
  assignRanks,
  computeSubjectResult,
  computeTermResult,
  conductGradeFor,
  gradeFor,
  round2,
} from './grading';

describe('gradeFor', () => {
  it.each([
    [100, 'A'],
    [80, 'A'],
    [79.99, 'B+'],
    [75, 'B+'],
    [70, 'B'],
    [65, 'C+'],
    [60, 'C'],
    [55, 'D+'],
    [50, 'D'],
    [49.99, 'F'],
    [0, 'F'],
  ])('maps %s%% to %s', (percentage, expected) => {
    expect(gradeFor(percentage).grade).toBe(expected);
  });

  it('treats each band boundary as inclusive of its lower bound', () => {
    // A student on exactly the threshold gets the higher grade — the difference
    // between passing and failing for someone on 50.
    expect(gradeFor(50).grade).toBe('D');
    expect(gradeFor(49.9).grade).toBe('F');
  });

  it('falls back to F when given a scale with no matching band', () => {
    const brokenScale: GradeBand[] = [{ grade: 'A', minPercentage: 90, gradePoint: 4 }];
    expect(gradeFor(10, brokenScale).grade).toBe('F');
  });
});

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(82.456)).toBe(82.46);
    expect(round2(82.454)).toBe(82.45);
  });

  it('avoids binary floating-point artefacts', () => {
    // 1.005 is not exactly representable; naive Math.round gives 1.
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('computeSubjectResult', () => {
  const fullyGraded: ComponentInput[] = [
    { componentId: 'a', nameLo: 'ວຽກບ້ານ', score: 8, maxScore: 10, weight: 20 },
    { componentId: 'b', nameLo: 'ສອບເສັງກາງພາກ', score: 24, maxScore: 30, weight: 30 },
    { componentId: 'c', nameLo: 'ສອບເສັງທ້າຍພາກ', score: 40, maxScore: 50, weight: 50 },
  ];

  it('computes the weighted percentage across components', () => {
    // 8/10×20 = 16, 24/30×30 = 24, 40/50×50 = 40 → 80
    const result = computeSubjectResult(fullyGraded);
    expect(result.percentage).toBe(80);
    expect(result.grade).toBe('A');
    expect(result.gradePoint).toBe(4);
    expect(result.isPassed).toBe(true);
    expect(result.isIncomplete).toBe(false);
  });

  it('reports each component contribution', () => {
    const result = computeSubjectResult(fullyGraded);
    expect(result.components.map((c) => c.weightedScore)).toEqual([16, 24, 40]);
  });

  it('marks the result incomplete when a component is ungraded', () => {
    const partial: ComponentInput[] = [
      { componentId: 'a', nameLo: 'ວຽກບ້ານ', score: 9, maxScore: 10, weight: 20 },
      { componentId: 'b', nameLo: 'ສອບເສັງທ້າຍພາກ', score: null, maxScore: 80, weight: 80 },
    ];
    expect(computeSubjectResult(partial).isIncomplete).toBe(true);
  });

  it('rescales a partial result over the weight recorded so far', () => {
    // The critical case: a student with 9/10 on the only marked component must
    // read as 90%, not as 18% — treating an unmarked exam as zero would show a
    // strong student as failing.
    const partial: ComponentInput[] = [
      { componentId: 'a', nameLo: 'ວຽກບ້ານ', score: 9, maxScore: 10, weight: 20 },
      { componentId: 'b', nameLo: 'ສອບເສັງທ້າຍພາກ', score: null, maxScore: 80, weight: 80 },
    ];
    const result = computeSubjectResult(partial);
    expect(result.percentage).toBe(90);
    expect(result.grade).toBe('A');
  });

  it('counts an absence as zero rather than as ungraded', () => {
    const withAbsence: ComponentInput[] = [
      { componentId: 'a', nameLo: 'ວຽກບ້ານ', score: 10, maxScore: 10, weight: 50 },
      {
        componentId: 'b',
        nameLo: 'ສອບເສັງ',
        score: null,
        maxScore: 50,
        weight: 50,
        isAbsent: true,
      },
    ];
    const result = computeSubjectResult(withAbsence);
    // Both components count; the absence contributes 0 of its 50.
    expect(result.percentage).toBe(50);
    expect(result.isIncomplete).toBe(false);
  });

  it('distinguishes a score of zero from an ungraded component', () => {
    const zeroScore = computeSubjectResult([
      { componentId: 'a', nameLo: 'x', score: 0, maxScore: 10, weight: 100 },
    ]);
    const ungraded = computeSubjectResult([
      { componentId: 'a', nameLo: 'x', score: null, maxScore: 10, weight: 100 },
    ]);

    expect(zeroScore.percentage).toBe(0);
    expect(zeroScore.isIncomplete).toBe(false);
    expect(ungraded.isIncomplete).toBe(true);
  });

  it('honours a subject-specific pass mark', () => {
    const components: ComponentInput[] = [
      { componentId: 'a', nameLo: 'x', score: 55, maxScore: 100, weight: 100 },
    ];
    expect(computeSubjectResult(components).isPassed).toBe(true); // default 50
    expect(computeSubjectResult(components, { passingPercentage: 60 }).isPassed).toBe(false);
  });

  it('returns zero rather than dividing by zero when nothing is graded', () => {
    const result = computeSubjectResult([
      { componentId: 'a', nameLo: 'x', score: null, maxScore: 10, weight: 100 },
    ]);
    expect(result.percentage).toBe(0);
    expect(Number.isNaN(result.percentage)).toBe(false);
  });

  it('handles a component whose maxScore is zero without producing NaN', () => {
    const result = computeSubjectResult([
      { componentId: 'a', nameLo: 'x', score: 0, maxScore: 0, weight: 100 },
    ]);
    expect(result.percentage).toBe(0);
  });

  it('accepts a custom grade scale', () => {
    const strict: GradeBand[] = [
      { grade: 'A', minPercentage: 95, gradePoint: 4 },
      { grade: 'F', minPercentage: 0, gradePoint: 0 },
    ];
    const result = computeSubjectResult(fullyGraded, { scale: strict });
    expect(result.percentage).toBe(80);
    expect(result.grade).toBe('F');
  });
});

describe('computeTermResult', () => {
  it('weights the average by credits', () => {
    // A 4-credit subject at 90 and a 1-credit at 40:
    // (90×4 + 40×1) / 5 = 80. An unweighted mean would be 65.
    const result = computeTermResult([
      { credits: 4, percentage: 90, gradePoint: 4, isPassed: true },
      { credits: 1, percentage: 40, gradePoint: 0, isPassed: false },
    ]);
    expect(result.average).toBe(80);
  });

  it('weights the GPA by credits too', () => {
    const result = computeTermResult([
      { credits: 3, percentage: 80, gradePoint: 4, isPassed: true },
      { credits: 1, percentage: 50, gradePoint: 1, isPassed: true },
    ]);
    // (4×3 + 1×1) / 4 = 3.25
    expect(result.gpa).toBe(3.25);
  });

  it('counts passed and failed subjects', () => {
    const result = computeTermResult([
      { credits: 1, percentage: 80, gradePoint: 4, isPassed: true },
      { credits: 1, percentage: 40, gradePoint: 0, isPassed: false },
      { credits: 1, percentage: 60, gradePoint: 2, isPassed: true },
    ]);
    expect(result.subjectsPassed).toBe(2);
    expect(result.subjectsFailed).toBe(1);
  });

  it('returns a zeroed result for an empty subject list', () => {
    const result = computeTermResult([]);
    expect(result).toEqual({
      average: 0,
      gpa: 0,
      grade: 'F',
      subjectsPassed: 0,
      subjectsFailed: 0,
    });
  });

  it('falls back to an unweighted mean when every subject has zero credits', () => {
    const result = computeTermResult([
      { credits: 0, percentage: 90, gradePoint: 4, isPassed: true },
      { credits: 0, percentage: 70, gradePoint: 3, isPassed: true },
    ]);
    expect(result.average).toBe(80);
    expect(Number.isNaN(result.average)).toBe(false);
  });

  it('derives the overall grade from the weighted average', () => {
    const result = computeTermResult(
      [{ credits: 1, percentage: 72, gradePoint: 3, isPassed: true }],
      DEFAULT_GRADE_SCALE,
    );
    expect(result.grade).toBe('B');
  });
});

describe('assignRanks', () => {
  it('ranks highest average first', () => {
    const ranks = assignRanks([
      { studentId: 'a', average: 70 },
      { studentId: 'b', average: 90 },
      { studentId: 'c', average: 80 },
    ]);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
    expect(ranks.get('a')).toBe(3);
  });

  it('gives tied students the same rank and skips the next (competition ranking)', () => {
    const ranks = assignRanks([
      { studentId: 'a', average: 90 },
      { studentId: 'b', average: 85 },
      { studentId: 'c', average: 85 },
      { studentId: 'd', average: 70 },
    ]);
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('b')).toBe(2);
    expect(ranks.get('c')).toBe(2);
    // 3 is skipped because two students occupy rank 2.
    expect(ranks.get('d')).toBe(4);
  });

  it('gives every student rank 1 when all averages are equal', () => {
    const ranks = assignRanks([
      { studentId: 'a', average: 75 },
      { studentId: 'b', average: 75 },
      { studentId: 'c', average: 75 },
    ]);
    expect([...ranks.values()]).toEqual([1, 1, 1]);
  });

  it('returns an empty map for no entries', () => {
    expect(assignRanks([]).size).toBe(0);
  });

  it('does not mutate the input array order', () => {
    const input = [
      { studentId: 'a', average: 70 },
      { studentId: 'b', average: 90 },
    ];
    assignRanks(input);
    expect(input[0].studentId).toBe('a');
  });
});

describe('conductGradeFor', () => {
  it.each([
    [95, 'excellent'],
    [90, 'excellent'],
    [85, 'very_good'],
    [75, 'good'],
    [65, 'fair'],
    [50, 'poor'],
    [0, 'poor'],
  ])('maps %s to %s', (score, expected) => {
    expect(conductGradeFor(score)).toBe(expected);
  });
});

/**
 * The school marks on its own 10-point sheet, so most subjects arrive as a single
 * ພາກຮຽນ rather than as components. What matters is that both roads meet: the
 * stored percentage has to mean the same thing either way, or a class cannot be
 * ranked and a GPA cannot be taken across the two.
 */
describe('computeSubjectFromMark', () => {
  it('carries a 10-point mark onto the same 0–100 scale', () => {
    // ເກວະລິນ's ພາກຮຽນ I on the real sheet.
    expect(computeSubjectFromMark(8.2, true)).toMatchObject({
      percentage: 82,
      grade: 'A',
      isPassed: true,
      isIncomplete: false,
    });
  });

  it("fails a mark under 5, which is the school's own pass line", () => {
    // ສີວິໄຊ: 4.89 out of 10 is the mark the sheet highlights in red.
    expect(computeSubjectFromMark(4.89, true)).toMatchObject({
      percentage: 48.9,
      grade: 'F',
      isPassed: false,
    });
  });

  it('honours a subject-specific pass mark', () => {
    expect(computeSubjectFromMark(5.5, true, { passingPercentage: 60 }).isPassed).toBe(false);
  });

  it('holds an unmarked subject back rather than failing it', () => {
    // No exam sat yet: zero for the arithmetic, but flagged so the term result
    // cannot be published on it.
    expect(computeSubjectFromMark(null, false)).toMatchObject({
      percentage: 0,
      isPassed: false,
      isIncomplete: true,
    });
  });

  it('flags a mark that exists but is not final', () => {
    // Two of three months in: there is a figure, and it is going to move.
    expect(computeSubjectFromMark(7.5, false)).toMatchObject({
      percentage: 75,
      isPassed: true,
      isIncomplete: true,
    });
  });
});
