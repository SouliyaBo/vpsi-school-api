import {
  type ClassDayRef,
  dayKey,
  hoursLate,
  recordingDeadline,
  type SchoolDayCalendar,
} from '../school-days/school-days';

/**
 * Which days a homeroom review is owed on, and whether it was filed.
 *
 * The school's own instruction: every ວັນພຸດ and ວັນສຸກ the homeroom teacher
 * looks at their room's attendance and behaviour, so a problem reaches the
 * guardian while it is still small. What this file adds is the part paper cannot
 * do — saying, of a given Wednesday, whether the review happened.
 *
 * Two rules matter and both come from the calendar rather than from the weekday:
 *
 * - a Wednesday the school did not teach on owes nothing, and its days are not
 *   dropped but carried into the next review day's window, so no stretch of the
 *   term goes unlooked-at merely because ບຸນປີໃໝ່ fell on a Wednesday;
 * - the deadline is the school's existing one — noon of the next working day —
 *   so Friday's review is due Monday noon, and `recordingDeadline` is reused
 *   rather than reimplemented. A second idea of "late" in the same system is a
 *   second thing to argue with a teacher about.
 *
 * Kept free of Mongoose and of Nest so the rules can be tested directly; the
 * service does the reads and hands the pieces in.
 */

/**
 * ວັນພຸດ ແລະ ວັນສຸກ — 3 and 5, matching `SchedulePeriod.dayOfWeek` (0 = Sunday).
 *
 * A constant rather than a setting, for the same reason the reminder cron is a
 * constant: the two days are what the school tells its staff out loud, and a
 * pair that could change underneath a term's filed reviews would make last
 * month's compliance report unreadable. Overridable per call for tests.
 */
export const REVIEW_WEEKDAYS: readonly number[] = [3, 5];

/** The least a calendar has to answer for these rules — `SchoolDayCalendar` does. */
export type ReviewCalendar = Pick<SchoolDayCalendar, 'isTeachingDay' | 'nextWorkingDay'>;

/** One day a review is owed on, with the stretch it has to account for. */
export interface ReviewDay {
  /** `yyyy-MM-dd` of the ວັນພຸດ/ວັນສຸກ. */
  date: string;
  /**
   * The first day the sheet accounts for — the day after the previous review
   * day, or the start of the window for the first one.
   */
  windowStart: string;
  /** The last day it accounts for, which is the review day itself. */
  windowEnd: string;
  /**
   * Noon of the next working day, as a UTC instant; `null` when the calendar
   * runs out before finding one, in which case nothing can be called late.
   */
  deadline: Date | null;
}

export type ReviewDayStatus = 'confirmed' | 'late' | 'missing' | 'pending';

/** What the log holds for one room on one review day. */
export interface FiledReview {
  classroomId: string;
  /** `yyyy-MM-dd` of the review day it answers for. */
  dueDate: string;
  /** When it was actually filed — what the deadline is measured against. */
  reviewedAt: Date;
  studentsFlagged: number;
  /** Of those, the ones the teacher recorded an action against. */
  studentsActioned: number;
  /** Of those actions, the ones that reached a guardian. */
  guardiansContacted: number;
}

/** A room that owes reviews, and who owes them. */
export interface ReviewSubject {
  classroomId: string;
  classroomName: string;
  /** `ມ.1`, so a row reads as the school says it. */
  gradeLevelCode: string | null;
  /**
   * `null` for a room with no homeroom teacher on file.
   *
   * Reported rather than skipped: a room nobody is responsible for is the most
   * important row on the report, and dropping it would hide the gap entirely.
   */
  teacherId: string | null;
  teacherCode: string | null;
  teacherName: string | null;
  studentsOnRoll: number;
}

/** One review day, as it stands for one room. */
export interface ReviewDayCell {
  date: string;
  status: ReviewDayStatus;
  /** When it was filed, ISO; `null` when it was not. */
  reviewedAt: string | null;
  /** Hours past the deadline; `0` when on time or not filed. */
  hoursLate: number;
  studentsFlagged: number;
  studentsActioned: number;
  guardiansContacted: number;
}

export interface ReviewComplianceRow extends ReviewSubject {
  days: ReviewDayCell[];
  /** Review days owed in the window — `pending` excluded, as nothing is owed yet. */
  due: number;
  confirmed: number;
  late: number;
  missing: number;
  pending: number;
  /** `(confirmed + late) / due`, 0–100 with one decimal. */
  reviewRate: number;
  /** Of the reviews filed, the share that beat the deadline. */
  onTimeRate: number;
  /** ISO of the most recent review, however late — what "has stopped looking" means. */
  lastReviewedAt: string | null;
  /** Totals across the window, so a row can be read without opening the cells. */
  studentsFlagged: number;
  studentsActioned: number;
  guardiansContacted: number;
}

export interface ReviewComplianceSummary {
  /** Rooms the report covers. */
  classrooms: number;
  due: number;
  confirmed: number;
  late: number;
  missing: number;
  pending: number;
  reviewRate: number;
  /** Rooms with at least one missing review — the ones to chase. */
  classroomsBehind: number;
  teachersBehind: number;
  /** Rooms with no homeroom teacher on file; nobody is being reminded of these. */
  classroomsUnassigned: number;
  guardiansContacted: number;
}

export interface ReviewCompliance {
  startDate: string;
  endDate: string;
  /** The day the report is measured up to — today, or the window's end once past. */
  asOf: string;
  semester: { id: string; nameLo: string; nameEn: string | null } | null;
  /** The review days the window owed, in order — the report's columns. */
  reviewDays: ReviewDay[];
  rows: ReviewComplianceRow[];
  summary: ReviewComplianceSummary;
}

const MS_PER_DAY = 86_400_000;

const toUtcMidnight = (value: Date | string): Date => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const rate = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

/**
 * The review days an inclusive window owes, each with the stretch it accounts for.
 *
 * `previousReviewDay` is the last review day *before* the window, so the first
 * sheet of the window accounts for the days since that one rather than pretending
 * the term started on Monday. Callers that have no earlier day — the first week
 * of a term — leave it out, and the first window then opens at `start`.
 *
 * Days after `asOf` are returned too: a Friday still ahead is a column the office
 * can see as `pending` rather than one that silently appears mid-week. What is
 * *not* owed yet is decided by `statusFor`, which is where the clock belongs.
 */
export function reviewDaysIn(
  window: { start: Date | string; end: Date | string; previousReviewDay?: Date | string | null },
  calendar: ReviewCalendar,
  weekdays: readonly number[] = REVIEW_WEEKDAYS,
  /** The class the sheet is owed by, so a day only it was off owes nothing. */
  forClass?: ClassDayRef | null,
): ReviewDay[] {
  const start = toUtcMidnight(window.start);
  const end = toUtcMidnight(window.end);
  if (end < start) return [];

  const days: ReviewDay[] = [];
  // Where the next sheet's window opens. The day after the previous review day
  // when there is one, so nothing between two reviews is unaccounted for;
  // otherwise the window's own start.
  let openedAt = window.previousReviewDay
    ? new Date(toUtcMidnight(window.previousReviewDay).getTime() + MS_PER_DAY)
    : start;
  if (openedAt < start) openedAt = start;

  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
    if (!weekdays.includes(cursor.getUTCDay())) continue;
    // A review day the school was shut on owes nothing. Its days are deliberately
    // *not* closed off: `openedAt` stays where it is, so the next review day
    // covers them instead.
    if (!calendar.isTeachingDay(cursor, forClass)) continue;

    days.push({
      date: dayKey(cursor),
      windowStart: dayKey(openedAt > cursor ? cursor : openedAt),
      windowEnd: dayKey(cursor),
      deadline: recordingDeadline(cursor, calendar as SchoolDayCalendar, { forClass }),
    });
    openedAt = new Date(cursor.getTime() + MS_PER_DAY);
  }

  return days;
}

/**
 * The review day a sheet filed *now* answers for — what the teacher's screen opens on.
 *
 * The most recent owed day up to today, rather than today itself: a teacher who
 * opens the system on Thursday morning is filing Wednesday's review, and offering
 * them a sheet dated Thursday would leave Wednesday permanently missing while
 * they believed they had done it. `null` when the term has not reached its first
 * review day.
 */
export function currentReviewDay(days: ReviewDay[], today: Date | string): ReviewDay | null {
  const key = dayKey(toUtcMidnight(today));
  const elapsed = days.filter((day) => day.date <= key);
  return elapsed.length > 0 ? elapsed[elapsed.length - 1] : null;
}

/**
 * Where one room stands on one review day.
 *
 * `pending` is the state that keeps the report honest, and it covers two cases:
 * a review day still ahead, and one whose deadline has not passed yet. Counting
 * either as missing would put every homeroom teacher in the report every
 * Wednesday afternoon, which is how a number stops being read.
 */
export function statusFor(
  day: ReviewDay,
  filed: FiledReview | undefined,
  now: Date,
): ReviewDayCell {
  const past = day.deadline !== null && now > day.deadline;

  if (!filed) {
    return {
      date: day.date,
      status: past ? 'missing' : 'pending',
      reviewedAt: null,
      hoursLate: 0,
      studentsFlagged: 0,
      studentsActioned: 0,
      guardiansContacted: 0,
    };
  }

  const late = day.deadline !== null && filed.reviewedAt > day.deadline;
  return {
    date: day.date,
    status: late ? 'late' : 'confirmed',
    reviewedAt: filed.reviewedAt.toISOString(),
    hoursLate: late && day.deadline ? hoursLate(filed.reviewedAt, day.deadline) : 0,
    studentsFlagged: filed.studentsFlagged,
    studentsActioned: filed.studentsActioned,
    guardiansContacted: filed.guardiansContacted,
  };
}

/**
 * The office's report: every room, every review day, filed or not.
 *
 * Starts from the rooms and the calendar rather than from the reviews on file —
 * the same inversion the coverage reports make, and for the same reason: a room
 * nobody has looked at is not a row in the log, it is the absence of one.
 */
export function buildReviewCompliance(input: {
  window: { start: Date | string; end: Date | string; asOf: Date | string };
  /** The days every room owes a sheet on, when no room is off on its own. */
  reviewDays: ReviewDay[];
  /**
   * One room's own review days, where they differ.
   *
   * A ວັນພຸດ that `ມ.1` was stood down for is not a sheet `ມ.1` owes, while every
   * other room owes theirs — so the shared list cannot be the answer for all of
   * them. Falls back to `reviewDays` for a room it has nothing to say about.
   */
  reviewDaysFor?: (classroomId: string) => ReviewDay[] | undefined;
  subjects: ReviewSubject[];
  filed: FiledReview[];
  now: Date;
  semester?: ReviewCompliance['semester'];
}): ReviewCompliance {
  const { reviewDays, subjects, filed, now } = input;

  const byRoomAndDay = new Map<string, FiledReview>();
  for (const review of filed) byRoomAndDay.set(`${review.classroomId}|${review.dueDate}`, review);

  const rows: ReviewComplianceRow[] = subjects.map((subject) => {
    const owed = input.reviewDaysFor?.(subject.classroomId) ?? reviewDays;
    const days = owed.map((day) =>
      statusFor(day, byRoomAndDay.get(`${subject.classroomId}|${day.date}`), now),
    );

    const count = (status: ReviewDayStatus) => days.filter((day) => day.status === status).length;
    const confirmed = count('confirmed');
    const late = count('late');
    const missing = count('missing');
    const pending = count('pending');
    const due = confirmed + late + missing;
    const filedDays = days.filter((day) => day.reviewedAt !== null);

    return {
      ...subject,
      days,
      due,
      confirmed,
      late,
      missing,
      pending,
      reviewRate: rate(confirmed + late, due),
      onTimeRate: rate(confirmed, confirmed + late),
      lastReviewedAt: filedDays.length > 0 ? filedDays[filedDays.length - 1].reviewedAt : null,
      studentsFlagged: days.reduce((sum, day) => sum + day.studentsFlagged, 0),
      studentsActioned: days.reduce((sum, day) => sum + day.studentsActioned, 0),
      guardiansContacted: days.reduce((sum, day) => sum + day.guardiansContacted, 0),
    };
  });

  const total = (pick: (row: ReviewComplianceRow) => number) =>
    rows.reduce((sum, row) => sum + pick(row), 0);
  const due = total((row) => row.due);
  const confirmed = total((row) => row.confirmed);
  const late = total((row) => row.late);
  const behind = rows.filter((row) => row.missing > 0);

  return {
    startDate: dayKey(toUtcMidnight(input.window.start)),
    endDate: dayKey(toUtcMidnight(input.window.end)),
    asOf: dayKey(toUtcMidnight(input.window.asOf)),
    semester: input.semester ?? null,
    reviewDays,
    rows,
    summary: {
      classrooms: rows.length,
      due,
      confirmed,
      late,
      missing: total((row) => row.missing),
      pending: total((row) => row.pending),
      reviewRate: rate(confirmed + late, due),
      classroomsBehind: behind.length,
      teachersBehind: new Set(
        behind.map((row) => row.teacherId).filter((id): id is string => id !== null),
      ).size,
      classroomsUnassigned: rows.filter((row) => row.teacherId === null).length,
      guardiansContacted: total((row) => row.guardiansContacted),
    },
  };
}
