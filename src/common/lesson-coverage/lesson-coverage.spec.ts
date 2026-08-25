import {
  buildCoverage,
  dayWindow,
  semesterCoversWindow,
  weekWindow,
  type CoverageAssignment,
  type CoverageSlot,
  type CoverageWritten,
} from './lesson-coverage';

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
  entries: 1,
  studentsNoted: 3,
  dates: ['2025-11-03'],
  ...overrides,
});

/** The week of 2025-11-03, read on `today`. */
const build = (
  assignments: CoverageAssignment[],
  rows: CoverageWritten[] = [],
  today = '2025-11-05',
) =>
  buildCoverage(weekWindow('2025-11-05', today, SEMESTER), assignments, rows, {
    covered: 'anyEntry',
    semester: { id: SEMESTER.id, nameLo: SEMESTER.nameLo, nameEn: SEMESTER.nameEn },
  });

describe('buildCoverage — the behaviour register’s rule', () => {
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
    const coverage = build([assignment()], [written({ entries: 1, studentsNoted: 6 })]);

    expect(coverage.rows[0]).toMatchObject({ status: 'recorded', entries: 1, studentsNoted: 6 });
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

    expect(coverage.rows[0]).toMatchObject({ lessonsTimetabled: 3, lessonsElapsed: 2 });
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
    const coverage = buildCoverage(
      beforeTermEnds,
      [assignment({ schedule: [on(MONDAY), on(THURSDAY)] })],
      [],
      { covered: 'anyEntry' },
    );

    // Thursday falls after the term ends, so only the Monday period is owed.
    expect(coverage.rows[0]).toMatchObject({ lessonsTimetabled: 1, lessonsElapsed: 1 });
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

    expect(coverage.rows[0]).toMatchObject({ lessonsTimetabled: 1, lessonsElapsed: 1 });
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
      scope: 'week',
      startDate: '2025-11-03',
      endDate: '2025-11-09',
      asOf: '2025-11-05',
      semester: { id: 'sem1' },
    });
  });

  it('says which days the lessons it is counting fall on', () => {
    // Twice on Monday, once on Thursday; read on Wednesday, so Thursday has not
    // happened yet and is not a day anyone has to account for.
    const coverage = build([assignment({ schedule: [on(MONDAY), on(MONDAY), on(THURSDAY)] })]);

    expect(coverage.rows[0].lessonDates).toEqual(['2025-11-03']);
  });

  it('lists each elapsed day once, however many periods it holds', () => {
    const coverage = build(
      [assignment({ schedule: [on(MONDAY), on(THURSDAY), on(THURSDAY)] })],
      [],
      '2025-11-20',
    );

    expect(coverage.rows[0]).toMatchObject({
      lessonsTimetabled: 3,
      lessonDates: ['2025-11-03', '2025-11-06'],
    });
  });
});

/**
 * The same report one day wide.
 *
 * A week's totals cannot answer "who wrote nothing on Monday": the register row a
 * teacher wrote on Tuesday counts towards the same week, so Monday's gap
 * disappears into it. Reading the day as its own window is what separates them.
 */
describe('buildCoverage — one day', () => {
  /** Monday 2025-11-03, read on `today`. */
  const buildDay = (
    assignments: CoverageAssignment[],
    rows: CoverageWritten[] = [],
    date = '2025-11-03',
    today = '2025-11-05',
  ) => buildCoverage(dayWindow(date, today, SEMESTER), assignments, rows, { covered: 'anyEntry' });

  it('counts only the periods timetabled on that day', () => {
    const coverage = buildDay([assignment({ schedule: [on(MONDAY), on(MONDAY), on(THURSDAY)] })]);

    expect(coverage.rows[0]).toMatchObject({
      lessonsTimetabled: 2,
      lessonsElapsed: 2,
      lessonDates: ['2025-11-03'],
      status: 'missing',
    });
  });

  it('names the day it answered for, both ends the same', () => {
    const coverage = buildDay([assignment()]);

    expect(coverage).toMatchObject({
      scope: 'day',
      startDate: '2025-11-03',
      endDate: '2025-11-03',
      asOf: '2025-11-03',
    });
  });

  it('leaves out a class not taught that day, rather than calling it behind', () => {
    const coverage = buildDay([assignment({ schedule: [on(THURSDAY)] })]);

    expect(coverage.rows).toEqual([]);
    expect(coverage.summary).toMatchObject({ expected: 0, missing: 0, teachersMissing: 0 });
  });

  it('has nothing owed on a day that has not come yet', () => {
    const coverage = buildDay([assignment({ schedule: [on(THURSDAY)] })], [], '2025-11-06');

    expect(coverage.rows[0]).toMatchObject({ status: 'not_yet', lessonsElapsed: 0 });
    expect(coverage.rows[0].lessonDates).toEqual([]);
  });

  it('has nothing at all outside the term', () => {
    // The term runs 01–30 November; the Monday before it is not a school day.
    const coverage = buildDay([assignment()], [], '2025-10-27', '2025-11-05');

    expect(coverage.rows).toEqual([]);
  });
});

/**
 * Which term a picked week belongs to.
 *
 * The report is now reached by picking a date, so the term can no longer be
 * assumed to be the active one: a date two terms back has to resolve to the term
 * that was running then, or the timetable read against it is the wrong timetable.
 */
describe('semesterCoversWindow', () => {
  /** The week of Monday 2025-11-03 – Sunday 2025-11-09. */
  const week = weekWindow('2025-11-05', '2025-11-05');
  const term = (startDate: string, endDate: string) => ({ startDate, endDate });

  it('accepts the term the week sits inside', () => {
    expect(semesterCoversWindow(term('2025-09-01', '2026-01-31'), week)).toBe(true);
  });

  it('refuses a term that closed before the week', () => {
    expect(semesterCoversWindow(term('2025-05-01', '2025-10-31'), week)).toBe(false);
  });

  it('refuses a term that opens after it', () => {
    expect(semesterCoversWindow(term('2025-11-10', '2026-03-31'), week)).toBe(false);
  });

  it('accepts a term running on only part of the week', () => {
    // The week a term ends and the week the next one opens are the two weeks of
    // the year where a strict "does it contain this date?" gets the wrong answer.
    expect(semesterCoversWindow(term('2025-06-01', '2025-11-05'), week)).toBe(true);
    expect(semesterCoversWindow(term('2025-11-09', '2026-03-31'), week)).toBe(true);
  });

  it('says no when there is no term at all, rather than throwing', () => {
    expect(semesterCoversWindow(null, week)).toBe(false);
  });
});

/**
 * The roll call's rule: owed once for every lesson day taught.
 *
 * Attendance is not written when there is something to say — it is written every
 * time a class meets. Judged by the register's rule, a teacher who marked Monday
 * and skipped Wednesday and Friday comes back "recorded", which is the one answer
 * the office cannot act on.
 */
describe('buildCoverage — the roll call’s rule', () => {
  const WEDNESDAY = 3;
  const FRIDAY = 5;

  /** The week of 2025-11-03, read once it is over so the whole week is owed. */
  const build3 = (rows: CoverageWritten[] = []) =>
    buildCoverage(
      weekWindow('2025-11-05', '2025-11-20', SEMESTER),
      [assignment({ schedule: [on(MONDAY), on(WEDNESDAY), on(FRIDAY)] })],
      rows,
      { covered: 'everyLessonDay' },
    );

  it('holds a teacher to the days they missed, not to whether they ever marked', () => {
    const coverage = build3([written({ dates: ['2025-11-03'] })]);

    expect(coverage.rows[0]).toMatchObject({
      status: 'missing',
      lessonsTimetabled: 3,
      missingDates: ['2025-11-05', '2025-11-07'],
    });
    // The register's rule would have called this covered — one entry exists.
    expect(coverage.summary).toMatchObject({ missing: 1, recorded: 0, teachersMissing: 1 });
  });

  it('clears a teacher only once every lesson day is marked', () => {
    const coverage = build3([written({ dates: ['2025-11-03', '2025-11-05', '2025-11-07'] })]);

    expect(coverage.rows[0]).toMatchObject({ status: 'recorded', missingDates: [] });
    expect(coverage.summary.coverageRate).toBe(100);
  });

  it('does not count a day still ahead against a teacher', () => {
    // Read on the Wednesday: Friday has not happened.
    const coverage = buildCoverage(
      weekWindow('2025-11-05', '2025-11-05', SEMESTER),
      [assignment({ schedule: [on(MONDAY), on(WEDNESDAY), on(FRIDAY)] })],
      [written({ dates: ['2025-11-03', '2025-11-05'] })],
      { covered: 'everyLessonDay' },
    );

    expect(coverage.rows[0]).toMatchObject({
      status: 'recorded',
      lessonsElapsed: 2,
      missingDates: [],
    });
  });

  it('names every day when nothing was marked at all', () => {
    const coverage = build3();

    expect(coverage.rows[0]).toMatchObject({
      status: 'missing',
      missingDates: ['2025-11-03', '2025-11-05', '2025-11-07'],
      lastDate: null,
    });
  });

  it('reports the last day marked, whatever order the days arrive in', () => {
    const coverage = build3([written({ dates: ['2025-11-07', '2025-11-03'] })]);

    expect(coverage.rows[0].lastDate).toBe('2025-11-07');
  });
});
