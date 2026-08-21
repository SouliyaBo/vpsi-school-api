import { endOfWeek, startOfWeek, toUtcMidnight, weekKey } from '../lesson-plans/lesson-plan-weeks';

/**
 * Assembly of the weekly coverage report for the behaviour register.
 *
 * The inversion here is the one `GET /behavior-logs` cannot do: the register
 * only holds rows somebody wrote, so a class nobody wrote about is not a row —
 * it is the absence of one, and absence is exactly what both readers of this
 * report are looking for. A teacher wants to be told what they still owe this
 * week, and the academic office wants to see which class and which teacher have
 * nothing on file. So the *expected* set comes from the timetable and the
 * written rows are matched into it.
 *
 * Kept free of Mongoose so the rules can be tested directly; the service does
 * the reads and hands the pieces in. The week runs Monday–Sunday, the same span
 * `lesson-plan-weeks` defines, because a second idea of where a school week
 * starts is a second thing to get wrong.
 */

/**
 * `not_yet` is the state that keeps the report honest: on a Tuesday, a class
 * taught only on Thursday owes nothing, and counting it as missing would train
 * everyone to ignore the number.
 */
export type CoverageStatus = 'recorded' | 'missing' | 'not_yet';

/**
 * The part of a timetable slot the count depends on.
 *
 * `isRotating` marks a slot two teachers take turns in. Every arrangement of the
 * swap is stored on the timetable — that is what makes the clash check let it
 * through — so the timetable cannot say which of them took which class on a
 * given day. See `SchedulePeriod.isRotating`.
 */
export interface CoverageSlot {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  isRotating?: boolean;
}

/** One (teacher, subject, class) the timetable says is taught this week. */
export interface CoverageAssignment {
  teachingAssignmentId: string;
  teacherId: string;
  teacherCode: string | null;
  teacherName: string;
  subjectId: string;
  subjectCode: string | null;
  subjectNameLo: string;
  subjectNameEn: string | null;
  classroomId: string;
  classroomName: string;
  /** `ມ.1` — carried so a row reads as the school says it, without a lookup. */
  gradeLevelCode: string | null;
  /**
   * The timetabled periods, one entry each — so a subject taught twice on Monday
   * counts twice.
   */
  schedule: CoverageSlot[];
}

/** What the register actually holds for one assignment inside the week. */
export interface CoverageWritten {
  teachingAssignmentId: string;
  /** Rows of the register — `groupId`s, not records, which is what a teacher writes. */
  rows: number;
  /** Students named across those rows; a class-only row contributes none. */
  studentsNoted: number;
  /** `yyyy-MM-dd` of the last row in the week. */
  lastDate: string | null;
}

export interface CoverageRow extends Omit<CoverageAssignment, 'schedule'> {
  /** Timetabled periods across the whole week, rotating slots excluded. */
  lessonsThisWeek: number;
  /** Of those, the ones already taught — up to and including `asOf`. */
  lessonsElapsed: number;
  rows: number;
  studentsNoted: number;
  lastDate: string | null;
  status: CoverageStatus;
}

export interface CoverageSummary {
  /** Assignments that owe something this week — `not_yet` excluded. */
  expected: number;
  recorded: number;
  missing: number;
  /** Taught later this week; nothing owed yet. */
  notYet: number;
  /** `recorded / expected`, 0–100, one decimal. */
  coverageRate: number;
  /** Distinct teachers and classes with at least one missing lesson. */
  teachersMissing: number;
  classroomsMissing: number;
}

export interface WeeklyCoverage {
  /** Monday and Sunday of the week, `yyyy-MM-dd`. */
  weekStartDate: string;
  weekEndDate: string;
  /**
   * The day the report is measured up to — today for the current week, the
   * week's own end once it is past. A finished week is judged whole.
   */
  asOf: string;
  semester: { id: string; nameLo: string; nameEn: string | null } | null;
  rows: CoverageRow[];
  /** Always the whole week, even when `rows` has been narrowed to the gaps. */
  summary: CoverageSummary;
}

export interface WeekWindow {
  weekStart: Date;
  weekEnd: Date;
  asOf: Date;
  /** Bounds of the term, when one is known — a lesson outside it is not owed. */
  semesterStart: Date | null;
  semesterEnd: Date | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * The Monday–Sunday window containing `date`, measured up to `today`.
 *
 * `asOf` stops at the week's end so a past week is judged whole, and is left at
 * today for a week still ahead — no day of it has elapsed, so every row comes
 * back `not_yet` rather than flagging a whole school as behind.
 */
export function weekWindow(
  date: string | Date,
  today: string | Date,
  semester?: { startDate: Date | string; endDate: Date | string } | null,
): WeekWindow {
  const weekStart = startOfWeek(date);
  const weekEnd = endOfWeek(weekStart);
  const now = toUtcMidnight(today);

  return {
    weekStart,
    weekEnd,
    asOf: now > weekEnd ? weekEnd : now,
    semesterStart: semester ? toUtcMidnight(semester.startDate) : null,
    semesterEnd: semester ? toUtcMidnight(semester.endDate) : null,
  };
}

/** Every calendar day of the week that the term is actually running on. */
function teachingDays(window: WeekWindow): Date[] {
  const days: Date[] = [];
  for (let cursor = window.weekStart; cursor <= window.weekEnd;) {
    const inTerm =
      (!window.semesterStart || cursor >= window.semesterStart) &&
      (!window.semesterEnd || cursor <= window.semesterEnd);
    if (inTerm) days.push(cursor);
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }
  return days;
}

/**
 * Crosses the timetable with what the register holds.
 *
 * An assignment with no lesson in the week is dropped rather than reported as
 * complete: it is not part of this week's question at all.
 *
 * Rotating slots are not counted, and an assignment whose every period rotates
 * therefore drops out entirely. The swap is precisely the case where the
 * timetable does not know who taught the class — both arrangements are on file
 * and the two teachers settle it between themselves — so holding either of them
 * to a row would flag them both for a lesson only one of them took.
 */
export function buildWeeklyCoverage(
  window: WeekWindow,
  assignments: CoverageAssignment[],
  written: CoverageWritten[],
  semester: WeeklyCoverage['semester'] = null,
): WeeklyCoverage {
  const days = teachingDays(window);
  const byAssignment = new Map(written.map((entry) => [entry.teachingAssignmentId, entry]));

  const rows: CoverageRow[] = [];
  for (const assignment of assignments) {
    const { schedule, ...meta } = assignment;
    const counted = schedule.filter((slot) => slot.isRotating !== true);
    const periodsOn = (day: Date) =>
      counted.filter((slot) => slot.dayOfWeek === day.getUTCDay()).length;

    const lessonsThisWeek = days.reduce((total, day) => total + periodsOn(day), 0);
    if (lessonsThisWeek === 0) continue;

    const lessonsElapsed = days
      .filter((day) => day <= window.asOf)
      .reduce((total, day) => total + periodsOn(day), 0);

    const entry = byAssignment.get(assignment.teachingAssignmentId);
    const recorded = entry?.rows ?? 0;

    rows.push({
      ...meta,
      lessonsThisWeek,
      lessonsElapsed,
      rows: recorded,
      studentsNoted: entry?.studentsNoted ?? 0,
      lastDate: entry?.lastDate ?? null,
      // A row written for a lesson still ahead in the week (the teacher filed
      // early, or the timetable moved) counts as recorded — the register has
      // something to show, which is the whole question being asked.
      status: recorded > 0 ? 'recorded' : lessonsElapsed > 0 ? 'missing' : 'not_yet',
    });
  }

  rows.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      (a.gradeLevelCode ?? '').localeCompare(b.gradeLevelCode ?? '') ||
      a.classroomName.localeCompare(b.classroomName) ||
      a.teacherName.localeCompare(b.teacherName) ||
      a.subjectNameLo.localeCompare(b.subjectNameLo),
  );

  return {
    weekStartDate: weekKey(window.weekStart),
    weekEndDate: weekKey(window.weekEnd),
    asOf: weekKey(window.asOf),
    semester,
    rows,
    summary: summarize(rows),
  };
}

/** Gaps first — the report is read for what is wrong with it. */
function rank(status: CoverageStatus): number {
  return status === 'missing' ? 0 : status === 'recorded' ? 1 : 2;
}

export function summarize(rows: CoverageRow[]): CoverageSummary {
  const missing = rows.filter((row) => row.status === 'missing');
  const recorded = rows.filter((row) => row.status === 'recorded').length;
  const notYet = rows.filter((row) => row.status === 'not_yet').length;
  const expected = rows.length - notYet;

  return {
    expected,
    recorded,
    missing: missing.length,
    notYet,
    coverageRate: expected === 0 ? 0 : Math.round((recorded / expected) * 1000) / 10,
    teachersMissing: new Set(missing.map((row) => row.teacherId)).size,
    classroomsMissing: new Set(missing.map((row) => row.classroomId)).size,
  };
}
