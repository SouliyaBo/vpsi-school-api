import {
  buildWeeklyCoverage,
  weekWindow,
  type CoverageAssignment,
  type CoverageSlot,
  type CoverageWritten,
} from './behavior-week';

/** Monday 2025-11-03 – Sunday 2025-11-09, inside a term that spans the month. */
const SEMESTER = {
  id: 'sem1',
  nameLo: 'ພາກຮຽນທີ 1',
  nameEn: 'Semester 1',
  startDate: new Date('2025-11-01'),
  endDate: new Date('2025-11-30'),
};

const MONDAY = 1;
const THURSDAY = 4;

/** A plain timetabled period on `dayOfWeek`. */
const on = (dayOfWeek: number): CoverageSlot => ({ dayOfWeek });

/** The same period run as a swap between two teachers. */
const rotating = (dayOfWeek: number): CoverageSlot => ({ dayOfWeek, isRotating: true });

const assignment = (overrides: Partial<CoverageAssignment> = {}): CoverageAssignment => ({
  teachingAssignmentId: 'ta1',
  teacherId: 't1',
  teacherCode: 'T-001',
  teacherName: 'ບຸນມີ ແກ້ວ',
  subjectId: 's1',
  subjectCode: 'MATH-M1',
  subjectNameLo: 'ຄະນິດສາດ',
  subjectNameEn: 'Mathematics',
  classroomId: 'c1',
  classroomName: 'ກ',
  gradeLevelCode: 'ມ.1',
  schedule: [on(MONDAY)],
  ...overrides,
});

const written = (overrides: Partial<CoverageWritten> = {}): CoverageWritten => ({
  teachingAssignmentId: 'ta1',
  rows: 1,
  studentsNoted: 3,
  lastDate: '2025-11-03',
  ...overrides,
});

/** The week of 2025-11-03, read on `today`. */
const build = (
  assignments: CoverageAssignment[],
  rows: CoverageWritten[] = [],
  today = '2025-11-05',
) =>
  buildWeeklyCoverage(weekWindow('2025-11-05', today, SEMESTER), assignments, rows, {
    id: SEMESTER.id,
    nameLo: SEMESTER.nameLo,
    nameEn: SEMESTER.nameEn,
  });

describe('buildWeeklyCoverage', () => {
  it('reports a taught lesson with nothing written as missing — the gap the log cannot show', () => {
    const coverage = build([assignment()]);

    expect(coverage.rows).toHaveLength(1);
    expect(coverage.rows[0].status).toBe('missing');
    expect(coverage.summary).toMatchObject({
      expected: 1,
      recorded: 0,
      missing: 1,
      teachersMissing: 1,
      classroomsMissing: 1,
    });
  });

  it('counts one row of the register as covered, however many students it named', () => {
    const coverage = build([assignment()], [written({ rows: 1, studentsNoted: 6 })]);

    expect(coverage.rows[0]).toMatchObject({ status: 'recorded', rows: 1, studentsNoted: 6 });
    expect(coverage.summary.coverageRate).toBe(100);
  });

  it('does not hold a teacher to a lesson later in the week', () => {
    // Read on Wednesday; the class is taught on Thursday.
    const coverage = build([assignment({ schedule: [on(THURSDAY)] })]);

    expect(coverage.rows[0].status).toBe('not_yet');
    // `not_yet` is outside the expected set, so it cannot drag the rate down.
    expect(coverage.summary).toMatchObject({ expected: 0, notYet: 1, missing: 0 });
  });

  it('judges a week that is over as a whole', () => {
    const coverage = build([assignment({ schedule: [on(THURSDAY)] })], [], '2025-11-20');

    expect(coverage.asOf).toBe('2025-11-09');
    expect(coverage.rows[0].status).toBe('missing');
  });

  it('leaves a week that has not started with nothing owed', () => {
    const coverage = build([assignment()], [], '2025-10-28');

    expect(coverage.rows[0]).toMatchObject({ status: 'not_yet', lessonsElapsed: 0 });
    expect(coverage.summary.expected).toBe(0);
  });

  it('counts each timetabled period, and only the ones already taught', () => {
    // Twice on Monday, once on Thursday; read on Wednesday.
    const coverage = build([assignment({ schedule: [on(MONDAY), on(MONDAY), on(THURSDAY)] })]);

    expect(coverage.rows[0]).toMatchObject({ lessonsThisWeek: 3, lessonsElapsed: 2 });
  });

  it('drops a lesson the class does not have this week rather than calling it covered', () => {
    const saturday = 6;
    const coverage = build([
      assignment(),
      assignment({ teachingAssignmentId: 'ta2', schedule: [] }),
      assignment({ teachingAssignmentId: 'ta3', schedule: [on(saturday)] }),
    ]);

    // The Saturday lesson stays — the school week runs to Sunday — but the
    // assignment with no timetabled period at all is not this week's question.
    expect(coverage.rows.map((row) => row.teachingAssignmentId).sort()).toEqual(['ta1', 'ta3']);
  });

  it('ignores a day the term is not running on', () => {
    const beforeTermEnds = weekWindow('2025-11-05', '2025-11-05', {
      startDate: '2025-11-01',
      endDate: '2025-11-03',
    });
    const coverage = buildWeeklyCoverage(
      beforeTermEnds,
      [assignment({ schedule: [on(MONDAY), on(THURSDAY)] })],
      [],
    );

    // Thursday falls after the term ends, so only the Monday period is owed.
    expect(coverage.rows[0]).toMatchObject({ lessonsThisWeek: 1, lessonsElapsed: 1 });
  });

  it('puts the gaps first, and counts distinct teachers and classes behind', () => {
    const coverage = build(
      [
        assignment({ teachingAssignmentId: 'ta1' }),
        assignment({
          teachingAssignmentId: 'ta2',
          teacherId: 't2',
          teacherName: 'ສົມໃຈ ວົງສາ',
          classroomId: 'c2',
          classroomName: 'ຂ',
        }),
        assignment({
          teachingAssignmentId: 'ta3',
          teacherId: 't2',
          teacherName: 'ສົມໃຈ ວົງສາ',
          subjectId: 's2',
          subjectNameLo: 'ຟີຊິກສາດ',
        }),
      ],
      [written({ teachingAssignmentId: 'ta1' })],
    );

    expect(coverage.rows[0].status).toBe('missing');
    expect(coverage.rows.at(-1)?.status).toBe('recorded');
    // Two rows missing, but one teacher and two classes behind.
    expect(coverage.summary).toMatchObject({
      missing: 2,
      recorded: 1,
      teachersMissing: 1,
      classroomsMissing: 2,
      coverageRate: 33.3,
    });
  });

  it('does not count a rotating slot — the timetable cannot say who taught it', () => {
    // The last period on Friday is a swap: both arrangements are on the
    // timetable, and which one ran is left to the two teachers. Only the Monday
    // period is owed.
    const coverage = build([assignment({ schedule: [on(MONDAY), rotating(THURSDAY)] })]);

    expect(coverage.rows[0]).toMatchObject({ lessonsThisWeek: 1, lessonsElapsed: 1 });
  });

  it('drops an assignment that is nothing but a swap, rather than flagging both teachers', () => {
    const coverage = build([
      assignment({ teachingAssignmentId: 'ta-swap-a', schedule: [rotating(MONDAY)] }),
      assignment({
        teachingAssignmentId: 'ta-swap-b',
        teacherId: 't2',
        teacherName: 'ສົມໃຈ ວົງສາ',
        schedule: [rotating(MONDAY)],
      }),
    ]);

    expect(coverage.rows).toEqual([]);
    expect(coverage.summary).toMatchObject({ expected: 0, missing: 0, teachersMissing: 0 });
  });

  it('names the week it answered for, so the screen cannot label it wrong', () => {
    const coverage = build([assignment()]);

    expect(coverage).toMatchObject({
      weekStartDate: '2025-11-03',
      weekEndDate: '2025-11-09',
      asOf: '2025-11-05',
      semester: { id: 'sem1' },
    });
  });
});
