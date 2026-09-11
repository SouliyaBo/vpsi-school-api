import type { CoverageAssignment } from '../lesson-coverage/lesson-coverage';
import { hoursLate, recordingDeadline, SchoolDayCalendar } from '../school-days/school-days';

/**
 * ຄວາມຕົງເວລາໃນການບັນທຶກ — was the paperwork done on time.
 *
 * A separate question from lesson coverage, and the reason for a separate report:
 * coverage asks *whether* a lesson was written up, which a teacher can satisfy a
 * fortnight late, and the school found that many of them do. So this asks *when*.
 *
 * The deadline is the school's: **noon of the next working day after the lesson**
 * — see `recordingDeadline`. Friday's roll call is due Monday noon; a lesson
 * before ບຸນປີໃໝ່ is due at noon on the day the school comes back. Which days
 * those are is the calendar's answer, not this file's.
 *
 * Unit of judgement: **one lesson day per class**, not one row.
 *
 * A roll call is stored a row per student, so a class of forty is forty rows
 * written in one act, and counting rows would report a teacher of large classes
 * as forty times as late as a teacher of small ones. The act is what is judged,
 * and `recordedAt` is the earliest `createdAt` of the rows it produced — the
 * moment the teacher pressed save. Two periods of the same class on the same day
 * are one act for the same reason: they are written up together.
 *
 * Kept free of Mongoose so the rules can be tested against hand-written lessons;
 * the services do the reads. Deliberately alongside `lesson-coverage` and sharing
 * its `CoverageAssignment`, so "which lessons did the timetable say happened" has
 * one answer and not two.
 */

const MS_PER_DAY = 86_400_000;

/**
 * What the log owes, which is the one rule the two logs do not share.
 *
 * - `everyLessonDay` — the roll call, owed for every lesson day taught. A day
 *   with nothing on file is a gap, and `missing` counts it.
 * - `entriesOnly` — the behaviour register, written when there is something to
 *   note. There is no such thing as a missing entry, so `missing` is `null` and
 *   the report is only about the entries that exist. Reporting gaps here would
 *   contradict the coverage report, which holds the register to `anyEntry`.
 */
export type TimelinessRule = 'everyLessonDay' | 'entriesOnly';

export interface TimelinessWindow {
  /** Inclusive bounds. */
  start: Date;
  end: Date;
  /**
   * The day the report is measured up to — today for a window still running.
   *
   * A lesson taught this morning is not late yet: its deadline is tomorrow noon.
   * So the cut is not `asOf` itself but every lesson whose deadline has passed,
   * which is what `judgedThrough` works out.
   */
  asOf: Date;
  semesterStart: Date | null;
  semesterEnd: Date | null;
}

/** One write-up: a class, a day, and the moment the teacher saved it. */
export interface WrittenLesson {
  teachingAssignmentId: string;
  /** `yyyy-MM-dd`. */
  date: string;
  recordedAt: Date;
}

/** A lesson day that went past its deadline, and by how much. */
export interface LateLesson {
  /** `yyyy-MM-dd` of the lesson. */
  date: string;
  /** Hours past noon of the next working day, one decimal. */
  hoursLate: number;
  classroomName: string;
  gradeLevelCode: string | null;
  subjectNameLo: string;
}

export interface TimelinessRow {
  teacherId: string;
  teacherCode: string | null;
  teacherName: string;
  /** Lesson days the timetable owed; `null` under `entriesOnly`. */
  owed: number | null;
  /** Lesson days written up at all, whenever that happened. */
  recorded: number;
  onTime: number;
  late: number;
  /** Owed and never written; `null` under `entriesOnly` — see `TimelinessRule`. */
  missing: number | null;
  /** `late / (onTime + late)`, 0–100 with one decimal. */
  lateRate: number;
  /** Mean hours past the deadline, over the late ones only. */
  avgHoursLate: number;
  worstHoursLate: number;
  /**
   * Written up, but too recently for the deadline to have passed.
   *
   * Held apart from `onTime` because it is not yet praise: a lesson taught this
   * morning and written this afternoon is simply not yet judged.
   */
  notYetDue: number;
  lastRecordedAt: string | null;
  /** The late days themselves, worst first — what a conversation is held over. */
  lateLessons: LateLesson[];
  /** `yyyy-MM-dd` of the owed days with nothing on file; empty under `entriesOnly`. */
  missingDates: string[];
}

export interface TimelinessSummary {
  owed: number | null;
  recorded: number;
  onTime: number;
  late: number;
  missing: number | null;
  notYetDue: number;
  /** `late / (onTime + late)` across the school, 0–100. */
  lateRate: number;
  avgHoursLate: number;
  /** Teachers with at least one late write-up. */
  teachersLate: number;
  /**
   * Lessons whose deadline the calendar cannot give — see `recordingDeadline`.
   *
   * Surfaced rather than folded into `onTime`: it is only ever non-zero when the
   * calendar runs out past the end of the filled-in year, and a report that
   * silently counted those as punctual would be flattering the school with its
   * own missing data.
   */
  unjudged: number;
}

export interface RecordTimeliness {
  startDate: string;
  endDate: string;
  asOf: string;
  /** The last lesson day whose deadline has passed — the honest edge of the report. */
  judgedThrough: string | null;
  rule: TimelinessRule;
  semester: { id: string; nameLo: string; nameEn: string | null } | null;
  rows: TimelinessRow[];
  summary: TimelinessSummary;
}

/** `yyyy-MM-dd` of a UTC-midnight date. */
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Every day of the window the school taught on, up to `asOf` and inside the term. */
function teachingDays(window: TimelinessWindow, calendar: SchoolDayCalendar): Date[] {
  const days: Date[] = [];
  const last = window.asOf < window.end ? window.asOf : window.end;
  for (
    let cursor = window.start;
    cursor <= last;
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  ) {
    const inTerm =
      (!window.semesterStart || cursor >= window.semesterStart) &&
      (!window.semesterEnd || cursor <= window.semesterEnd);
    if (inTerm && calendar.isTeachingDay(cursor)) days.push(cursor);
  }
  return days;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Crosses the timetable and the log with the calendar's deadlines.
 *
 * `now` is when the report is being read, which is what decides whether a
 * deadline has passed — passed in rather than taken from the clock so the whole
 * thing stays a function of its arguments.
 */
export function buildTimeliness(
  window: TimelinessWindow,
  assignments: CoverageAssignment[],
  written: WrittenLesson[],
  calendar: SchoolDayCalendar,
  options: {
    rule: TimelinessRule;
    now: Date;
    semester?: RecordTimeliness['semester'];
  },
): RecordTimeliness {
  const { rule, now } = options;
  const days = teachingDays(window, calendar);

  // Deadlines are per lesson day, and a day is shared by every class taught on
  // it — so they are worked out once here rather than per assignment.
  const deadlines = new Map<string, Date | null>();
  for (const day of days) deadlines.set(dayKey(day), recordingDeadline(day, calendar));

  const writtenBy = new Map(
    written.map((entry) => [`${entry.teachingAssignmentId}|${entry.date}`, entry]),
  );

  type Bucket = Omit<TimelinessRow, 'lateRate' | 'avgHoursLate' | 'worstHoursLate'> & {
    lateHours: number[];
    lastRecordedTime: number;
  };
  const byTeacher = new Map<string, Bucket>();

  const bucketFor = (assignment: CoverageAssignment): Bucket => {
    const existing = byTeacher.get(assignment.teacherId);
    if (existing) return existing;
    const fresh: Bucket = {
      teacherId: assignment.teacherId,
      teacherCode: assignment.teacherCode,
      teacherName: assignment.teacherName,
      owed: rule === 'everyLessonDay' ? 0 : null,
      recorded: 0,
      onTime: 0,
      late: 0,
      missing: rule === 'everyLessonDay' ? 0 : null,
      notYetDue: 0,
      lastRecordedAt: null,
      lateLessons: [],
      missingDates: [],
      lateHours: [],
      lastRecordedTime: 0,
    };
    byTeacher.set(assignment.teacherId, fresh);
    return fresh;
  };

  let unjudged = 0;

  for (const assignment of assignments) {
    // Rotating slots are left out for the same reason coverage leaves them out:
    // both arrangements of the swap are on the timetable, so it cannot say which
    // of the two teachers took the class, and holding either of them to a
    // deadline would put one teacher's lateness on the other's row.
    const counted = assignment.schedule.filter((slot) => slot.isRotating !== true);
    if (counted.length === 0) continue;

    const bucket = bucketFor(assignment);

    for (const day of days) {
      if (!counted.some((slot) => slot.dayOfWeek === day.getUTCDay())) continue;

      const key = dayKey(day);
      const deadline = deadlines.get(key) ?? null;
      const entry = writtenBy.get(`${assignment.teachingAssignmentId}|${key}`);

      if (rule === 'everyLessonDay' && bucket.owed !== null) bucket.owed += 1;

      if (!entry) {
        // Nothing on file. Only a gap once the deadline has passed — before that
        // the teacher is simply not late yet, and under `entriesOnly` there was
        // never anything owed.
        if (rule === 'everyLessonDay' && bucket.missing !== null) {
          if (deadline && deadline <= now) {
            bucket.missing += 1;
            bucket.missingDates.push(key);
          } else if (!deadline) {
            unjudged += 1;
          }
        }
        continue;
      }

      bucket.recorded += 1;
      bucket.lastRecordedTime = Math.max(bucket.lastRecordedTime, entry.recordedAt.getTime());

      if (!deadline) {
        unjudged += 1;
        continue;
      }

      const over = hoursLate(entry.recordedAt, deadline);
      if (over > 0) {
        bucket.late += 1;
        bucket.lateHours.push(over);
        bucket.lateLessons.push({
          date: key,
          hoursLate: over,
          classroomName: assignment.classroomName,
          gradeLevelCode: assignment.gradeLevelCode,
          subjectNameLo: assignment.subjectNameLo,
        });
      } else if (deadline <= now) {
        bucket.onTime += 1;
      } else {
        // Written already, and its deadline has not come — punctual, but the
        // report will not call it that until there is nothing left to lose.
        bucket.notYetDue += 1;
      }
    }
  }

  const rows: TimelinessRow[] = [];
  for (const bucket of byTeacher.values()) {
    const { lateHours, lastRecordedTime, ...rest } = bucket;
    const judged = rest.onTime + rest.late;
    rows.push({
      ...rest,
      lastRecordedAt: lastRecordedTime > 0 ? new Date(lastRecordedTime).toISOString() : null,
      lateLessons: [...rest.lateLessons].sort((a, b) => b.hoursLate - a.hoursLate),
      missingDates: [...rest.missingDates].sort(),
      lateRate: judged > 0 ? round1((rest.late / judged) * 100) : 0,
      avgHoursLate:
        lateHours.length > 0
          ? round1(lateHours.reduce((sum, hours) => sum + hours, 0) / lateHours.length)
          : 0,
      worstHoursLate: lateHours.length > 0 ? Math.max(...lateHours) : 0,
    });
  }

  /**
   * Worst first, where "worst" is how much there is to talk about: the late
   * write-ups and the missing ones together. A rate alone would put a teacher
   * with one lesson and one late write-up at the top of the school.
   */
  rows.sort((a, b) => {
    const weight = (row: TimelinessRow) => row.late + (row.missing ?? 0);
    return (
      weight(b) - weight(a) || b.lateRate - a.lateRate || a.teacherName.localeCompare(b.teacherName)
    );
  });

  const total = <K extends keyof TimelinessRow>(field: K) =>
    rows.reduce((sum, row) => sum + ((row[field] as number | null) ?? 0), 0);

  const late = total('late');
  const onTime = total('onTime');
  const judged = onTime + late;
  const allLateHours = rows.flatMap((row) => row.lateLessons.map((lesson) => lesson.hoursLate));

  // The last lesson day the report can actually judge — anything after it has a
  // deadline still in the future, and saying so is what stops the final days of
  // a window reading as a school that stopped filing.
  const judgedThrough =
    [...deadlines.entries()]
      .filter(([, deadline]) => deadline !== null && deadline <= now)
      .map(([key]) => key)
      .sort()
      .pop() ?? null;

  return {
    startDate: dayKey(window.start),
    endDate: dayKey(window.end),
    asOf: dayKey(window.asOf),
    judgedThrough,
    rule,
    semester: options.semester ?? null,
    rows,
    summary: {
      owed: rule === 'everyLessonDay' ? total('owed') : null,
      recorded: total('recorded'),
      onTime,
      late,
      missing: rule === 'everyLessonDay' ? total('missing') : null,
      notYetDue: total('notYetDue'),
      lateRate: judged > 0 ? round1((late / judged) * 100) : 0,
      avgHoursLate:
        allLateHours.length > 0
          ? round1(allLateHours.reduce((sum, hours) => sum + hours, 0) / allLateHours.length)
          : 0,
      teachersLate: rows.filter((row) => row.late > 0).length,
      unjudged,
    },
  };
}
