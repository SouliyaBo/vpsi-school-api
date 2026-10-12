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

  it('does not owe a lesson on a day the school did not teach', () => {
    // The school calendar closes Monday — a holiday, or an exam period the office
    // suspended the timetable for. Before `nonTeachingDays` existed this reported
    // the teacher as behind for a lesson that never ran, which is the gap nobody
    // can act on and the reason the whole report was being ignored.
    const window = {
      ...weekWindow('2025-11-05', '2025-11-05', SEMESTER),
      nonTeachingDays: new Set(['2025-11-03']),
    };
    const coverage = buildCoverage(
      window,
      [assignment({ schedule: [on(MONDAY), on(THURSDAY)] })],
      [],
      { covered: 'anyEntry' },
    );

    // Monday is not counted, and Thursday has not been taught yet on the 5th.
    expect(coverage.rows[0]).toMatchObject({
      lessonsTimetabled: 1,
      lessonsElapsed: 0,
      status: 'not_yet',
      missingDates: [],
    });
  });

  it('still reports the gaps on the days around a closure', () => {
    const window = {
      ...weekWindow('2025-11-07', '2025-11-07', SEMESTER),
      nonTeachingDays: new Set(['2025-11-03']),
    };
    const coverage = buildCoverage(
      window,
      [assignment({ schedule: [on(MONDAY), on(THURSDAY)] })],
      [],
      { covered: 'everyLessonDay' },
    );

    // Thursday was taught and went unwritten; Monday is not on the list at all.
    expect(coverage.rows[0].missingDates).toEqual(['2025-11-06']);
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

/**
 * Cover: a lesson one teacher was away for and another took.
 *
 * The question the office asked for, and the reason the claim exists: a teacher
 * off sick must not appear in this report as the one who never marked the roll,
 * and the colleague who actually taught the class must appear as the one who owes
 * it. Nothing is stored against either of them — the report derives whose day it
 * was, which is why a claim filed on the morning is accounted for the first time
 * anybody reads the report afterwards.
 */
describe('buildCoverage — a covered lesson', () => {
  const WEDNESDAY = 3;
  const FRIDAY = 5;

  const stand = { teacherId: 't9', teacherCode: 'T-009', teacherName: 'ຄຳຫລ້າ ວົງສາ' };

  /** Monday, Wednesday and Friday of a week already over, so all three are owed. */
  const build3 = (substitutions?: Map<string, typeof stand>, rows: CoverageWritten[] = []) =>
    buildCoverage(
      weekWindow('2025-11-05', '2025-11-20', SEMESTER),
      [assignment({ schedule: [on(MONDAY), on(WEDNESDAY), on(FRIDAY)] })],
      rows,
      { covered: 'everyLessonDay', substitutions },
    );

  it('moves the covered day off the absent teacher and onto the stand-in', () => {
    const coverage = build3(new Map([['ta1|2025-11-05', stand]]), [
      written({ dates: ['2025-11-03', '2025-11-07'] }),
    ]);

    const owner = coverage.rows.find((row) => row.teacherId === 't1');
    const cover = coverage.rows.find((row) => row.teacherId === 't9');

    // The Wednesday is no longer the timetabled teacher's to answer for, and the
    // two days that were theirs are marked — so they are clear.
    expect(owner).toMatchObject({
      status: 'recorded',
      lessonDates: ['2025-11-03', '2025-11-07'],
      missingDates: [],
    });
    // Not flagged at all, rather than flagged false: an ordinary row carries no
    // trace of a feature that did not touch it.
    expect(owner).not.toHaveProperty('isSubstitute');
    // And the day nobody marked lands on the teacher who took the class.
    expect(cover).toMatchObject({
      status: 'missing',
      lessonDates: ['2025-11-05'],
      missingDates: ['2025-11-05'],
      isSubstitute: true,
      coveringForTeacherName: 'ບຸນມີ ແກ້ວ',
      // Named for the person on the row, not for the timetable.
      teacherCode: 'T-009',
    });
    // One gap in the school, and it belongs to one teacher — not two rows of it.
    expect(coverage.summary).toMatchObject({ missing: 1, recorded: 1, teachersMissing: 1 });
  });

  it('credits the stand-in for the day they did mark', () => {
    const coverage = build3(new Map([['ta1|2025-11-05', stand]]), [
      written({ dates: ['2025-11-03', '2025-11-05', '2025-11-07'] }),
    ]);

    expect(coverage.rows.find((row) => row.teacherId === 't9')).toMatchObject({
      status: 'recorded',
      missingDates: [],
      lastDate: '2025-11-05',
    });
    expect(coverage.summary).toMatchObject({ missing: 0, recorded: 2, coverageRate: 100 });
  });

  it('leaves a fully covered lesson owing nothing to the teacher who was away', () => {
    const coverage = build3(
      new Map([
        ['ta1|2025-11-03', stand],
        ['ta1|2025-11-05', stand],
        ['ta1|2025-11-07', stand],
      ]),
    );

    // A week away is a week of lessons that were never theirs to write up, so the
    // timetabled teacher has no row at all rather than a row of three gaps.
    expect(coverage.rows.map((row) => row.teacherId)).toEqual(['t9']);
    expect(coverage.rows[0]).toMatchObject({
      lessonsTimetabled: 3,
      missingDates: ['2025-11-03', '2025-11-05', '2025-11-07'],
    });
  });

  it('gives an ordinary lesson exactly the row it had before cover existed', () => {
    const marked = [written({ dates: ['2025-11-03', '2025-11-05', '2025-11-07'] })];

    expect(build3(new Map(), marked).rows).toEqual(build3(undefined, marked).rows);
  });

  it('splits the entries between them by day, not by the window’s total', () => {
    const coverage = buildCoverage(
      weekWindow('2025-11-05', '2025-11-20', SEMESTER),
      [assignment({ schedule: [on(MONDAY), on(WEDNESDAY)] })],
      [
        written({
          entries: 3,
          studentsNoted: 7,
          dates: ['2025-11-03', '2025-11-05'],
          perDay: [
            { date: '2025-11-03', entries: 1, studentsNoted: 2 },
            { date: '2025-11-05', entries: 2, studentsNoted: 5 },
          ],
        }),
      ],
      { covered: 'anyEntry', substitutions: new Map([['ta1|2025-11-05', stand]]) },
    );

    // The window's own totals — 3 rows, 7 students — belong to neither of them
    // whole, and a report that showed each of them all of it would be reporting
    // the school twice.
    expect(coverage.rows.find((row) => row.teacherId === 't1')).toMatchObject({
      entries: 1,
      studentsNoted: 2,
    });
    expect(coverage.rows.find((row) => row.teacherId === 't9')).toMatchObject({
      entries: 2,
      studentsNoted: 5,
    });
  });

  it('ignores cover claimed on a rotating slot, which it cannot attribute anyway', () => {
    const coverage = buildCoverage(
      weekWindow('2025-11-05', '2025-11-20', SEMESTER),
      [assignment({ schedule: [rotating(MONDAY), on(WEDNESDAY)] })],
      [],
      {
        covered: 'everyLessonDay',
        substitutions: new Map([['ta1|2025-11-03', stand]]),
      },
    );

    // The Monday swap is not counted for either teacher — the timetable cannot say
    // who took it — so cover on it changes nothing, and the Wednesday stays with
    // the teacher the timetable gives it to.
    expect(coverage.rows).toHaveLength(1);
    expect(coverage.rows[0]).toMatchObject({
      teacherId: 't1',
      lessonsTimetabled: 1,
      missingDates: ['2025-11-05'],
    });
  });
});

/**
 * A timetable that was revised: which day was this lesson owed on *then*?
 *
 * The hole these close was the widest of the three. Every report derives the days
 * a lesson was owed on by reading its weekday, and the schedule was replaced in
 * place — so moving a lesson from Monday to Wednesday did not change next week, it
 * changed every week behind it. A teacher who had taught and marked every Monday
 * came back as never having marked a Wednesday, right to the start of term, and
 * the punctuality report defaults to the whole term to date.
 */
describe('buildCoverage — a lesson that moved weekday', () => {
  const MONDAY_14 = '2025-11-10';
  const WEDNESDAY_16 = '2025-11-12';

  /** The week of 10 Nov 2025, read once it is over so the whole week is owed. */
  const build = (overrides: Partial<CoverageAssignment>, marked: string[]) =>
    buildCoverage(
      weekWindow('2025-11-12', '2025-11-30', SEMESTER),
      [assignment(overrides)],
      [written({ dates: marked })],
      { covered: 'everyLessonDay' },
    );

  it('holds the teacher to the day the timetable said at the time', () => {
    const coverage = build(
      {
        // Moved to Wednesday from the following week.
        schedule: [on(3)],
        scheduleHistory: [
          { from: '2025-01-01', to: '2025-11-17', schedule: [on(MONDAY)] },
          { from: '2025-11-17', to: null, schedule: [on(3)] },
        ],
      },
      [MONDAY_14],
    );

    // The Monday they taught and marked still counts, and the Wednesday they were
    // never timetabled for is not a gap.
    expect(coverage.rows[0]).toMatchObject({
      status: 'recorded',
      lessonDates: [MONDAY_14],
      missingDates: [],
    });
  });

  it('is the bug it exists to stop, when the history is not there', () => {
    // The same week and the same roll call, judged by today's arrangement alone —
    // which is what every report did before spells were recorded.
    const coverage = build({ schedule: [on(3)] }, [MONDAY_14]);

    expect(coverage.rows[0]).toMatchObject({
      status: 'missing',
      missingDates: [WEDNESDAY_16],
    });
  });

  it('owes the new day once the change has taken effect', () => {
    const coverage = buildCoverage(
      weekWindow('2025-11-19', '2025-11-30', SEMESTER),
      [
        assignment({
          schedule: [on(3)],
          scheduleHistory: [
            { from: '2025-01-01', to: '2025-11-17', schedule: [on(MONDAY)] },
            { from: '2025-11-17', to: null, schedule: [on(3)] },
          ],
        }),
      ],
      [],
      { covered: 'everyLessonDay' },
    );

    // The week after the move: Wednesday is owed, Monday is not.
    expect(coverage.rows[0]).toMatchObject({ missingDates: ['2025-11-19'] });
  });

  it('leaves a lesson that has never moved exactly as it was', () => {
    const marked = [MONDAY_14];

    expect(build({ scheduleHistory: [] }, marked).rows).toEqual(build({}, marked).rows);
  });
});
