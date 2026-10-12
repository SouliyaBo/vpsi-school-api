import type { CoverageAssignment } from '../lesson-coverage/lesson-coverage';
import { SchoolDayCalendar, type SchoolDayEvent } from '../school-days/school-days';
import { buildTimeliness, type TimelinessWindow, type WrittenLesson } from './record-timeliness';

/**
 * A fortnight of the school's own 2026–2027 calendar: Mon 7 – Fri 18 Sep 2026,
 * with the Teacher PD day the sheet puts on Mon 21 Sep just past the end of it.
 *
 * Real dates rather than invented ones, because every rule under test is a rule
 * about which day comes next, and the cases that matter are the ones the school's
 * calendar actually produces — a Friday lesson, a Monday nobody teaches, and the
 * edge of the window where a deadline has not arrived yet.
 */
const EVENTS: SchoolDayEvent[] = [
  {
    titleLo: 'ຝຶກອົບຮົມຄູ (ນັກຮຽນພັກ)',
    type: 'professional_development',
    dayEffect: 'no_classes',
    startDate: '2026-09-21',
    endDate: '2026-09-21',
  },
  {
    titleLo: 'ພັກວັນຄູແຫ່ງຊາດ',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-09-16',
    endDate: '2026-09-16',
  },
];

const calendar = new SchoolDayCalendar(EVENTS);

const MONDAY = 1;
const WEDNESDAY = 3;
const FRIDAY = 5;

const SEMESTER = {
  id: 'sem1',
  nameLo: 'ພາກຮຽນທີ 1',
  nameEn: 'Semester 1',
};

const assignment = (overrides: Partial<CoverageAssignment> = {}): CoverageAssignment => ({
  teachingAssignmentId: 'ta1',
  teacherId: 't1',
  teacherCode: 'T-2627-001',
  teacherName: 'ສົມເພັດ ພັນໂນລາດ',
  subjectId: 's1',
  subjectCode: 'MATH-M1',
  subjectNameLo: 'ຄະນິດສາດ',
  subjectNameEn: 'Mathematics',
  classroomId: 'c1',
  classroomName: 'ກ',
  gradeLevelCode: 'ມ.1',
  schedule: [{ dayOfWeek: MONDAY }],
  ...overrides,
});

/** Mon 7 – Fri 18 Sep 2026, read at `now`. */
const window = (): TimelinessWindow => ({
  start: new Date('2026-09-07'),
  end: new Date('2026-09-18'),
  asOf: new Date('2026-09-18'),
  semesterStart: new Date('2026-08-17'),
  semesterEnd: new Date('2026-12-10'),
});

const build = (
  assignments: CoverageAssignment[],
  written: WrittenLesson[] = [],
  now = '2026-09-25T03:00:00.000Z',
  rule: 'everyLessonDay' | 'entriesOnly' = 'everyLessonDay',
) =>
  buildTimeliness(window(), assignments, written, calendar, {
    rule,
    now: new Date(now),
    semester: SEMESTER,
  });

/** `at('2026-09-08', 11)` — 11:00 Vientiane on that day, as a UTC instant. */
const at = (date: string, hourLocal: number) =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() + (hourLocal - 7) * 3_600_000);

describe('buildTimeliness — the roll call', () => {
  it('counts a lesson written before noon the next day as on time', () => {
    const coverage = build(
      [assignment()],
      [
        { teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 11) },
        { teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-14', 15) },
      ],
    );

    expect(coverage.rows[0]).toMatchObject({
      owed: 2,
      recorded: 2,
      onTime: 2,
      late: 0,
      missing: 0,
    });
    expect(coverage.summary.lateRate).toBe(0);
  });

  it('counts one written an hour after noon the next day as late', () => {
    const coverage = build(
      [assignment()],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 13) }],
    );

    expect(coverage.rows[0]).toMatchObject({ late: 1, onTime: 0, worstHoursLate: 1 });
    expect(coverage.rows[0].lateLessons[0]).toMatchObject({ date: '2026-09-07', hoursLate: 1 });
  });

  it('gives a Friday lesson until Monday noon', () => {
    // Written Monday 11:00 — an hour inside a deadline a plain "next day" rule
    // would have put on Saturday and failed them for.
    const coverage = build(
      [assignment({ schedule: [{ dayOfWeek: FRIDAY }] })],
      [
        { teachingAssignmentId: 'ta1', date: '2026-09-11', recordedAt: at('2026-09-14', 11) },
        { teachingAssignmentId: 'ta1', date: '2026-09-18', recordedAt: at('2026-09-21', 11) },
      ],
    );

    expect(coverage.rows[0]).toMatchObject({ onTime: 2, late: 0 });
  });

  it('lets the deadline fall on a Teacher PD day, because the staff are in', () => {
    // Fri 18 Sep is due Mon 21 Sep noon even though no lesson runs that day.
    const coverage = build(
      [assignment({ schedule: [{ dayOfWeek: FRIDAY }] })],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-18', recordedAt: at('2026-09-21', 14) }],
    );

    expect(coverage.rows[0]).toMatchObject({ late: 1, worstHoursLate: 2 });
  });

  it('owes nothing for a lesson day the school was shut', () => {
    // Wed 16 Sep is a holiday here, so only the 9th is owed.
    const coverage = build([assignment({ schedule: [{ dayOfWeek: WEDNESDAY }] })]);

    expect(coverage.rows[0]).toMatchObject({ owed: 1, missing: 1, missingDates: ['2026-09-09'] });
  });

  it('counts a lesson day with nothing on file as missing, not as late', () => {
    const coverage = build([assignment()]);

    expect(coverage.rows[0]).toMatchObject({ recorded: 0, late: 0, missing: 2 });
    expect(coverage.rows[0].missingDates).toEqual(['2026-09-07', '2026-09-14']);
    // A rate over nothing judged is 0 rather than NaN or 100.
    expect(coverage.rows[0].lateRate).toBe(0);
  });

  it('does not call a lesson late before its deadline has come', () => {
    // Read on Tue 15 Sep at 09:00: Monday's write-up is due at noon that day.
    const coverage = build([assignment()], [], '2026-09-15T02:00:00.000Z');

    expect(coverage.rows[0]).toMatchObject({ owed: 2, missing: 1, missingDates: ['2026-09-07'] });
    // Monday the 14th is owed but not yet late: its deadline is noon that day.
    // `judgedThrough` is a fact about the window rather than about this one class
    // — Friday the 11th is the last day of it that any lesson can be judged on,
    // because its deadline was noon on Monday the 14th.
    expect(coverage.judgedThrough).toBe('2026-09-11');
  });

  it('holds a write-up whose deadline has not passed apart from the punctual ones', () => {
    const coverage = build(
      [assignment()],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-14', 16) }],
      '2026-09-15T02:00:00.000Z',
    );

    // Filed early on the 14th, due noon on the 15th, read at 09:00 — not yet
    // praise, and certainly not a gap.
    expect(coverage.rows[0]).toMatchObject({ recorded: 1, onTime: 0, late: 0, notYetDue: 1 });
  });

  it('judges one act per class per day, however many rows or periods it holds', () => {
    // Two periods of the same class on the same Monday: one write-up, not two.
    const coverage = build(
      [assignment({ schedule: [{ dayOfWeek: MONDAY }, { dayOfWeek: MONDAY }] })],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 11) }],
    );

    expect(coverage.rows[0]).toMatchObject({ owed: 2, recorded: 1, onTime: 1 });
  });

  it('does not hold either teacher of a rotating slot to it', () => {
    const coverage = build([assignment({ schedule: [{ dayOfWeek: MONDAY, isRotating: true }] })]);

    expect(coverage.rows).toHaveLength(0);
  });

  it('puts the teacher with most to answer for first', () => {
    const coverage = build(
      [
        assignment({ teachingAssignmentId: 'ta1', teacherId: 't1', teacherName: 'ຄູ ໜຶ່ງ' }),
        assignment({
          teachingAssignmentId: 'ta2',
          teacherId: 't2',
          teacherName: 'ຄູ ສອງ',
          schedule: [{ dayOfWeek: MONDAY }, { dayOfWeek: WEDNESDAY }],
        }),
      ],
      [
        // t1 filed both of its Mondays, one of them late.
        { teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-09', 11) },
        { teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-15', 11) },
      ],
    );

    // t2 filed nothing at all: 3 missing (two Mondays, one Wednesday — the 16th
    // is a holiday) against t1's single late one.
    expect(coverage.rows.map((row) => row.teacherName)).toEqual(['ຄູ ສອງ', 'ຄູ ໜຶ່ງ']);
    expect(coverage.rows[0].missing).toBe(3);
    expect(coverage.summary).toMatchObject({ late: 1, missing: 3, teachersLate: 1 });
  });

  it('averages lateness over the late ones only, not over every lesson', () => {
    const coverage = build(
      [assignment()],
      [
        { teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 11) },
        { teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-15', 15) },
      ],
    );

    // One on time, one three hours late — the average of the late ones is 3.
    expect(coverage.rows[0]).toMatchObject({ onTime: 1, late: 1, avgHoursLate: 3, lateRate: 50 });
  });
});

describe('buildTimeliness — the behaviour register', () => {
  it('has no such thing as a missing entry', () => {
    const coverage = build([assignment()], [], '2026-09-25T03:00:00.000Z', 'entriesOnly');

    // The register is written when there is something to note, so nothing is
    // owed — reporting gaps here would contradict the coverage report's own rule.
    expect(coverage.rows[0]).toMatchObject({ owed: null, missing: null, missingDates: [] });
    expect(coverage.summary).toMatchObject({ owed: null, missing: null });
  });

  it('still judges the entries that were made', () => {
    const coverage = build(
      [assignment()],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-09', 12) }],
      '2026-09-25T03:00:00.000Z',
      'entriesOnly',
    );

    expect(coverage.rows[0]).toMatchObject({ recorded: 1, late: 1, worstHoursLate: 24 });
  });
});

describe('buildTimeliness — honesty about what it cannot judge', () => {
  it('counts a lesson the calendar gives no deadline for rather than passing it', () => {
    // A calendar that ends on the lesson itself: `nextWorkingDay` searches sixty
    // days past Monday the 7th, finds every one of them outside the school year,
    // and so has no deadline to give.
    const bare = new SchoolDayCalendar([], { yearEnd: '2026-09-07' });
    const coverage = buildTimeliness(
      window(),
      [assignment()],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-30', 11) }],
      bare,
      { rule: 'everyLessonDay', now: new Date('2026-10-30T03:00:00.000Z') },
    );

    expect(coverage.summary.unjudged).toBeGreaterThan(0);
    expect(coverage.summary.late).toBe(0);
    expect(coverage.summary.onTime).toBe(0);
  });
});

/**
 * Cover: the report that was blaming the teacher who was off sick.
 *
 * This is the one the office noticed. A teacher away on Monday cannot write
 * Monday's roll call up by noon on Tuesday, so the punctuality report named them
 * every time — and naming the wrong person is worse than naming nobody, because
 * the report then has to be argued with rather than acted on.
 *
 * The deadline itself does not move: it belongs to the day. What moves is whose
 * row the day lands on.
 */
describe('buildTimeliness — a covered lesson', () => {
  const stand = { teacherId: 't9', teacherCode: 'T-2627-009', teacherName: 'ຄຳຫລ້າ ວົງສາ' };

  /** Mon 7 and Mon 14 Sep, with cover claimed on the 7th. */
  const covered = new Map([['ta1|2026-09-07', stand]]);

  it('does not report the absent teacher for a day they did not teach', () => {
    const report = buildTimeliness(
      window(),
      [assignment()],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-15', 11) }],
      calendar,
      {
        rule: 'everyLessonDay',
        now: new Date('2026-09-25T03:00:00.000Z'),
        substitutions: covered,
        semester: SEMESTER,
      },
    );

    const owner = report.rows.find((row) => row.teacherId === 't1');
    const cover = report.rows.find((row) => row.teacherId === 't9');

    // One Monday each. The absent teacher's own Monday was written up on time, and
    // the Monday they were away from is not on their row at all.
    expect(owner).toMatchObject({ owed: 1, onTime: 1, late: 0, missing: 0, missingDates: [] });
    // The gap is the stand-in's, under their own name and code.
    expect(cover).toMatchObject({
      owed: 1,
      recorded: 0,
      missing: 1,
      missingDates: ['2026-09-07'],
      teacherCode: 'T-2627-009',
    });
    expect(report.summary).toMatchObject({ owed: 2, missing: 1, onTime: 1 });
  });

  it('holds the stand-in to the same deadline, not to a softer one', () => {
    const report = buildTimeliness(
      window(),
      [assignment()],
      [
        // Monday the 7th, written at 13:00 on the 8th — an hour past noon.
        { teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 13) },
        { teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-15', 11) },
      ],
      calendar,
      {
        rule: 'everyLessonDay',
        now: new Date('2026-09-25T03:00:00.000Z'),
        substitutions: covered,
        semester: SEMESTER,
      },
    );

    expect(report.rows.find((row) => row.teacherId === 't9')).toMatchObject({
      late: 1,
      worstHoursLate: 1,
      lateLessons: [expect.objectContaining({ date: '2026-09-07', hoursLate: 1 })],
    });
    // And the lateness stays off the row of the teacher who was away.
    expect(report.rows.find((row) => row.teacherId === 't1')).toMatchObject({
      late: 0,
      onTime: 1,
    });
  });

  it('splits one lesson across the week it was covered in, day by day', () => {
    const report = buildTimeliness(
      window(),
      [assignment({ schedule: [{ dayOfWeek: MONDAY }, { dayOfWeek: WEDNESDAY }] })],
      [],
      calendar,
      {
        rule: 'everyLessonDay',
        now: new Date('2026-09-25T03:00:00.000Z'),
        // Away for the Monday only; back for the Wednesday of the same lesson.
        substitutions: new Map([['ta1|2026-09-07', stand]]),
        semester: SEMESTER,
      },
    );

    // Two Mondays and one Wednesday are taught — Wed 16 Sep is ພັກວັນຄູແຫ່ງຊາດ — and
    // one of the three was covered, so the lesson's days are 2 and 1 and not 3 and 3.
    expect(report.rows.find((row) => row.teacherId === 't1')?.owed).toBe(2);
    expect(report.rows.find((row) => row.teacherId === 't9')?.owed).toBe(1);
  });

  it('drops a colleague’s row when the report is about one teacher', () => {
    const report = buildTimeliness(
      window(),
      [assignment()],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-14', recordedAt: at('2026-09-15', 11) }],
      calendar,
      {
        rule: 'everyLessonDay',
        now: new Date('2026-09-25T03:00:00.000Z'),
        substitutions: covered,
        onlyTeacherId: 't9',
        semester: SEMESTER,
      },
    );

    // Reading the stand-in's own report has to read the lesson they covered, which
    // belongs to somebody else on the timetable — but the summary beside their row
    // must count their day and not the owner's.
    expect(report.rows.map((row) => row.teacherId)).toEqual(['t9']);
    expect(report.summary).toMatchObject({ owed: 1, missing: 1, onTime: 0 });
  });

  it('leaves an uncovered fortnight exactly as it was', () => {
    const written = [
      { teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 11) },
    ];

    expect(build([assignment()], written).rows).toEqual(
      buildTimeliness(window(), [assignment()], written, calendar, {
        rule: 'everyLessonDay',
        now: new Date('2026-09-25T03:00:00.000Z'),
        substitutions: new Map(),
        semester: SEMESTER,
      }).rows,
    );
  });
});

/**
 * The punctuality report under a revised timetable.
 *
 * This is the one that mattered most: it defaults to the whole term to date, and
 * it is the number the office judges teachers by. Before spells were recorded, one
 * timetable revision rewrote it for every teacher at once.
 */
describe('buildTimeliness — a lesson that moved weekday', () => {
  const moved = (): CoverageAssignment =>
    assignment({
      // Monday until 14 Sep, Wednesday from then on.
      schedule: [{ dayOfWeek: WEDNESDAY }],
      scheduleHistory: [
        { from: '2026-01-01', to: '2026-09-14', schedule: [{ dayOfWeek: MONDAY }] },
        { from: '2026-09-14', to: null, schedule: [{ dayOfWeek: WEDNESDAY }] },
      ],
    });

  it('judges each day against the timetable in force on it', () => {
    const report = build(
      [moved()],
      [
        // Mon 7 Sep — owed under the old arrangement, written up on time.
        { teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 11) },
        // Wed 16 Sep is ພັກວັນຄູແຫ່ງຊາດ, so the first Wednesday owed is the 9th —
        // which falls before the move and is therefore not owed at all.
      ],
    );

    // One lesson day in the fortnight, and it was marked punctually. Without the
    // history this read as one missed Wednesday and one Monday that counted for
    // nothing.
    expect(report.rows[0]).toMatchObject({ owed: 1, onTime: 1, missing: 0, missingDates: [] });
  });

  it('is the bug it exists to stop, when the history is not there', () => {
    const report = build(
      [assignment({ schedule: [{ dayOfWeek: WEDNESDAY }] })],
      [{ teachingAssignmentId: 'ta1', date: '2026-09-07', recordedAt: at('2026-09-08', 11) }],
    );

    // The same teacher, the same fortnight, the same roll call: now a gap on a
    // Wednesday they were never timetabled for, and no credit for the Monday.
    expect(report.rows[0]).toMatchObject({ onTime: 0, missing: 1, missingDates: ['2026-09-09'] });
  });
});
