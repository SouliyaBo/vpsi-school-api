import {
  responsibleTeacher,
  type LessonSubstitute,
  type SubstitutionIndex,
} from '../lesson-access/lesson-write-access';
import {
  endOfWeek,
  startOfWeek,
  toUtcMidnight,
  weekKey,
} from '../../modules/lesson-plans/lesson-plan-weeks';

/**
 * Assembly of a "who has not filled this in" report, over any per-lesson record.
 *
 * The inversion here is the one a plain list endpoint cannot do: a log only holds
 * what somebody wrote, so a class nobody wrote about is not a row — it is the
 * absence of one, and absence is exactly what the reader of such a report is
 * looking for. So the *expected* set comes from the timetable, and what was
 * written is matched into it.
 *
 * Two logs are read this way, and they differ in one rule only, which is why this
 * is one implementation and not two:
 *
 * - the **behaviour register** is written when there is something to note, so one
 *   entry anywhere in the window is the whole of what is owed;
 * - the **roll call** is owed once for every lesson day taught, so a teacher who
 *   marked Monday and skipped Wednesday is behind — the same "any entry" rule
 *   would report them as complete, which is the one answer nobody can act on.
 *
 * Kept free of Mongoose so the rules can be tested directly; the calling service
 * does the reads and hands the pieces in. A week runs Monday–Sunday, the same span
 * `lesson-plan-weeks` defines, because a second idea of where a school week starts
 * is a second thing to get wrong.
 */

/**
 * How wide the report was read.
 *
 * A week is the unit these logs are chased in, but "which teacher wrote nothing on
 * Monday" is a question about one day, and answering it with the week's totals
 * gives a teacher credit on Monday for a row they wrote on Tuesday. So the window
 * is either, and the report says which — a screen that labels a day's numbers as
 * a week's is the one way this report can lie.
 */
export type CoverageScope = 'day' | 'week';

/**
 * What counts as covered.
 *
 * The two logs owe different things, and this is the difference: `anyEntry` for a
 * log written when there is something to say, `everyLessonDay` for one owed per
 * lesson taught.
 */
export type CoverageRule = 'anyEntry' | 'everyLessonDay';

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

/**
 * One arrangement of a lesson's periods and the days it was in force.
 *
 * `from` inclusive, `to` exclusive, both `yyyy-MM-dd` — see `ScheduleSpell`.
 */
export interface CoverageScheduleSpell {
  from: string;
  to: string | null;
  schedule: CoverageSlot[];
}

/** One (teacher, subject, class) the timetable says is taught. */
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
  /**
   * Earlier arrangements of those periods, oldest first.
   *
   * What stops a timetable revision rewriting the weeks behind it: a report walks
   * days, so it has to ask what the timetable said *on that day* rather than what
   * it says now. Omitted or empty means the lesson has never moved, and `schedule`
   * is the answer for every day — which is every lesson in a school that revises
   * nothing.
   */
  scheduleHistory?: CoverageScheduleSpell[];
}

/** One day's worth of what the log holds, for a window that has to be split. */
export interface CoverageWrittenDay {
  /** `yyyy-MM-dd`. */
  date: string;
  entries: number;
  studentsNoted: number;
}

/** What the log actually holds for one assignment inside the window. */
export interface CoverageWritten {
  teachingAssignmentId: string;
  /** Entries as the teacher makes them — a register row, or one lesson's roll call. */
  entries: number;
  /** Students named across those entries; a class-only register row contributes none. */
  studentsNoted: number;
  /**
   * The days something was written on, `yyyy-MM-dd`.
   *
   * What `everyLessonDay` is checked against, and what lets any report say *which*
   * day went unwritten rather than only how many did.
   */
  dates: string[];
  /**
   * The same counts, per day.
   *
   * Needed only when a window has to be split between a teacher and a stand-in who
   * covered part of it: `entries` and `studentsNoted` are totals over the whole
   * window, and a total cannot be divided between two people after the fact.
   * Optional, so a caller with nothing to split keeps handing over the totals and
   * the ordinary row is computed exactly as it always was.
   */
  perDay?: CoverageWrittenDay[];
}

export interface CoverageRow extends Omit<CoverageAssignment, 'schedule'> {
  /** Timetabled periods across the whole window, rotating slots excluded. */
  lessonsTimetabled: number;
  /** Of those, the ones already taught — up to and including `asOf`. */
  lessonsElapsed: number;
  /**
   * The days those elapsed lessons fall on, `yyyy-MM-dd`.
   *
   * A week's row saying "0 of 2 written" does not say *which* two days went
   * unwritten, and "which day" is the first thing asked of a teacher holding the
   * report. Only elapsed days are listed, for the same reason `lessonsElapsed`
   * counts only those: a lesson still ahead is not yet a gap to explain.
   */
  lessonDates: string[];
  /** The elapsed lesson days with nothing written on them — the days to chase. */
  missingDates: string[];
  entries: number;
  studentsNoted: number;
  /** `yyyy-MM-dd` of the last entry in the window. */
  lastDate: string | null;
  status: CoverageStatus;
  /**
   * This row is a stand-in's share of somebody else's lesson.
   *
   * A substituted lesson comes back as two rows rather than one relabelled row:
   * the days each of them was responsible for, under their own name. That is what
   * makes the report add up — the reminder built on it messages whoever the row
   * names, and a single row could only ever name one of the two.
   */
  isSubstitute?: boolean;
  /** The timetabled teacher this row is covering for; `null` on an ordinary row. */
  coveringForTeacherName?: string | null;
}

export interface CoverageSummary {
  /** Assignments that owe something in the window — `not_yet` excluded. */
  expected: number;
  recorded: number;
  missing: number;
  /** Taught later in the window; nothing owed yet. */
  notYet: number;
  /** `recorded / expected`, 0–100, one decimal. */
  coverageRate: number;
  /** Distinct teachers and classes with at least one missing lesson. */
  teachersMissing: number;
  classroomsMissing: number;
}

export interface LessonCoverage {
  /** `day` for a single date, `week` for Monday–Sunday. */
  scope: CoverageScope;
  /**
   * The window's inclusive bounds, `yyyy-MM-dd` — Monday and Sunday of the week,
   * or the one date twice when `scope` is `day`.
   */
  startDate: string;
  endDate: string;
  /**
   * The day the report is measured up to — today for a window still running, the
   * window's own end once it is past. A finished week is judged whole.
   */
  asOf: string;
  semester: { id: string; nameLo: string; nameEn: string | null } | null;
  rows: CoverageRow[];
  /** Always the whole window, even when `rows` has been narrowed to the gaps. */
  summary: CoverageSummary;
}

export interface CoverageWindow {
  scope: CoverageScope;
  /** Inclusive bounds; equal to each other when `scope` is `day`. */
  start: Date;
  end: Date;
  asOf: Date;
  /** Bounds of the term, when one is known — a lesson outside it is not owed. */
  semesterStart: Date | null;
  semesterEnd: Date | null;
  /**
   * `yyyy-MM-dd` of the days inside the window the school did not teach on —
   * weekends, holidays, Teacher PD days and exam periods, from `calendarEvents`.
   *
   * Without it this report counted a lesson owed on every timetabled weekday of
   * the window, and so reported the whole school as behind for the week of
   * ບຸນປີໃໝ່ and for every exam period the office suspended the timetable for.
   * A gap nobody could have filled trains everyone to ignore the number, which
   * costs more than the gaps it finds.
   *
   * Optional so the pure functions stay callable without a calendar; a caller
   * that omits it gets the old behaviour and should be treated as not yet wired.
   */
  nonTeachingDays?: ReadonlySet<string>;
  /**
   * The same, for one classroom — the school's days off plus that class's own.
   *
   * The school stands a single year or a single room down without closing:
   * `ມ.7` sitting a national exam, a room whose teacher is away. Those days are
   * non-teaching for that class and ordinary teaching days for every other, so
   * one shared set cannot express them — it would either owe `ມ.7` a lesson it
   * was excused or excuse the whole school along with it.
   *
   * Given as a lookup rather than a map so the caller decides how a room
   * resolves to its closures; `nonTeachingDays` stays the answer for a room it
   * has nothing special to say about.
   */
  nonTeachingDaysFor?: (classroomId: string) => ReadonlySet<string> | undefined;
}

/** The term's dates, however they are carried. */
type SemesterDates = { startDate: Date | string; endDate: Date | string };

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
  semester?: SemesterDates | null,
): CoverageWindow {
  const start = startOfWeek(date);
  const end = endOfWeek(start);
  const now = toUtcMidnight(today);

  return {
    scope: 'week',
    start,
    end,
    asOf: now > end ? end : now,
    semesterStart: semester ? toUtcMidnight(semester.startDate) : null,
    semesterEnd: semester ? toUtcMidnight(semester.endDate) : null,
  };
}

/**
 * The one-day window containing `date`, measured up to `today`.
 *
 * Everything downstream counts over the days between the bounds, so a day is just
 * that window one day wide — no second implementation of "which periods were
 * taught, and what was written against them". What it buys is a question the week
 * cannot answer: a row written on Tuesday no longer covers the Monday lesson that
 * nobody wrote up, because Tuesday is not in the window.
 *
 * `asOf` behaves as it does for a week — a past day is judged whole, and a day
 * still ahead has nothing elapsed, so every row of it comes back `not_yet`.
 */
export function dayWindow(
  date: string | Date,
  today: string | Date,
  semester?: SemesterDates | null,
): CoverageWindow {
  const day = toUtcMidnight(date);
  const now = toUtcMidnight(today);

  return {
    scope: 'day',
    start: day,
    end: day,
    asOf: now > day ? day : now,
    semesterStart: semester ? toUtcMidnight(semester.startDate) : null,
    semesterEnd: semester ? toUtcMidnight(semester.endDate) : null,
  };
}

/**
 * Whether a term is running on any day of the window — not merely on one date.
 *
 * The window is chosen by picking a date, so the term can no longer be assumed to
 * be the active one: a date two terms back has to resolve to the term that was
 * running then, or the timetable read against it is the wrong timetable. Asked of
 * the whole window rather than of the picked day so the week a term begins or ends
 * mid-way through still resolves to it: those are the two weeks of the year where
 * "which term is this?" has a wrong answer available.
 */
export function semesterCoversWindow(
  semester: SemesterDates | null | undefined,
  window: Pick<CoverageWindow, 'start' | 'end'>,
): boolean {
  if (!semester) return false;
  return (
    toUtcMidnight(semester.startDate) <= window.end &&
    toUtcMidnight(semester.endDate) >= window.start
  );
}

/**
 * The term a window belongs to, for a report reached by picking a date.
 *
 * The active term is tried first: it is the answer for every window inside the
 * term in progress, and for one the calendar has no term for at all — a holiday,
 * or the gap between two terms — it is the only answer there is. A window inside
 * an earlier term resolves to that term instead, which is the whole point:
 * without this, asking in February about a week in October reads the timetable of
 * the current term against a week outside it and reports a school with no lessons,
 * rather than the gaps that are actually on file.
 *
 * Typed structurally rather than against `SemestersService` so this file stays
 * free of the module graph.
 */
export async function resolveCoverageSemester<T extends SemesterDates>(
  semesters: {
    findActive(): Promise<T | null>;
    findForRange(from: Date, to: Date): Promise<T | null>;
  },
  window: CoverageWindow,
): Promise<T | null> {
  const active = await semesters.findActive();
  if (semesterCoversWindow(active, window)) return active;
  return (await semesters.findForRange(window.start, window.end)) ?? active;
}

/**
 * Every calendar day of the window the school actually taught on.
 *
 * Two filters, and they are separate because they are separate facts: the term's
 * bounds say whether the school was in session at all, and the calendar says
 * whether this particular day inside it was taught.
 */
function teachingDays(window: CoverageWindow, classroomId?: string): Date[] {
  const off =
    (classroomId ? window.nonTeachingDaysFor?.(classroomId) : undefined) ?? window.nonTeachingDays;

  const days: Date[] = [];
  for (let cursor = window.start; cursor <= window.end;) {
    const inTerm =
      (!window.semesterStart || cursor >= window.semesterStart) &&
      (!window.semesterEnd || cursor <= window.semesterEnd);
    const taught = !off?.has(cursor.toISOString().slice(0, 10));
    if (inTerm && taught) days.push(cursor);
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }
  return days;
}

/**
 * Crosses the timetable with what the log holds.
 *
 * An assignment with no lesson in the window is dropped rather than reported as
 * complete: it is not part of this window's question at all.
 *
 * The window may be a week or a single day; nothing here needs to know which,
 * because both are read as the days between its bounds.
 *
 * Rotating slots are not counted, and an assignment whose every period rotates
 * therefore drops out entirely. The swap is precisely the case where the
 * timetable does not know who taught the class — both arrangements are on file
 * and the two teachers settle it between themselves — so holding either of them
 * to an entry would flag them both for a lesson only one of them took.
 */
export function buildCoverage(
  window: CoverageWindow,
  assignments: CoverageAssignment[],
  written: CoverageWritten[],
  options: {
    covered: CoverageRule;
    semester?: LessonCoverage['semester'];
    /**
     * The lesson-days somebody stood in on — see `LessonSubstitution`.
     *
     * This is the whole of how a covered day stops being owed by the teacher who
     * was away. Nothing is stored against them to be corrected: the report never
     * held whose day it was, it derives it, so a claim filed at eight in the
     * morning is accounted for the first time the report is read afterwards.
     *
     * Optional, and an absent index simply means nobody covered anything — which
     * is what every window looked like before the school could say otherwise.
     */
    substitutions?: SubstitutionIndex;
  },
): LessonCoverage {
  // Per classroom, because a class can be off on a day the school teaches. Cached
  // by room: a week is a handful of rooms and thirty-odd assignments, so walking
  // the window once per assignment would be the same answer computed six times.
  const daysByClassroom = new Map<string, Date[]>();
  const daysFor = (classroomId: string) => {
    const cached = daysByClassroom.get(classroomId);
    if (cached) return cached;
    const computed = teachingDays(window, classroomId);
    daysByClassroom.set(classroomId, computed);
    return computed;
  };

  const byAssignment = new Map(written.map((entry) => [entry.teachingAssignmentId, entry]));

  const rows: CoverageRow[] = [];
  for (const assignment of assignments) {
    // Split off the row's own fields: the timetable is read per day below rather
    // than copied onto the row.
    const { schedule, scheduleHistory, ...meta } = assignment;
    const timetable = { schedule, scheduleHistory };
    const days = daysFor(assignment.classroomId);
    /**
     * Asked per day, not once per lesson: a lesson that moved from Monday to
     * Wednesday was taught on Mondays before the move and Wednesdays after, and a
     * report that reads only today's arrangement reports the one it never had.
     */
    const periodsOn = (day: Date) =>
      slotsOn(timetable, weekKey(day)).filter(
        (slot) => slot.isRotating !== true && slot.dayOfWeek === day.getUTCDay(),
      ).length;

    const taught = days.filter((day) => periodsOn(day) > 0);
    if (taught.length === 0) continue;

    const entry = byAssignment.get(assignment.teachingAssignmentId);

    /**
     * The window's lesson days, split between whoever was responsible for each.
     *
     * Insertion order puts the timetabled teacher first whenever any day is still
     * theirs, which keeps the ordinary report reading as it always did; a lesson
     * covered from end to end leaves only the stand-in's row.
     */
    const byTeacher = new Map<string, { who: LessonSubstitute; days: Date[] }>();
    for (const day of taught) {
      const who = responsibleTeacher(assignment, weekKey(day), options.substitutions);
      const bucket = byTeacher.get(who.teacherId);
      if (bucket) bucket.days.push(day);
      else byTeacher.set(who.teacherId, { who, days: [day] });
    }

    for (const [teacherId, bucket] of byTeacher) {
      const isSubstitute = teacherId !== assignment.teacherId;
      rows.push(
        buildRow(meta, bucket.who, bucket.days, periodsOn, window.asOf, entry, options.covered, {
          isSubstitute,
          // Only when the row is not the whole of the lesson, so an untouched
          // report carries no new fields at all.
          split: byTeacher.size > 1 || isSubstitute,
          ownerName: assignment.teacherName,
        }),
      );
    }
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
    scope: window.scope,
    startDate: weekKey(window.start),
    endDate: weekKey(window.end),
    asOf: weekKey(window.asOf),
    semester: options.semester ?? null,
    rows,
    summary: summarize(rows),
  };
}

/**
 * The periods a lesson was taught in on one day.
 *
 * The whole of effective-dating, in one lookup. A lesson with no recorded moves
 * answers with its current arrangement for every day, which is both the common
 * case and the correct one.
 *
 * A day earlier than the oldest spell answers with that spell: it is the oldest
 * arrangement anybody wrote down, so it is the best available account of what the
 * timetable said before — and it is what the report said for that day before the
 * first revision was recorded.
 */
export function slotsOn(
  assignment: Pick<CoverageAssignment, 'schedule' | 'scheduleHistory'>,
  day: string,
): CoverageSlot[] {
  const spells = assignment.scheduleHistory;
  if (!spells || spells.length === 0) return assignment.schedule;

  const inForce = spells.find(
    (spell) => spell.from <= day && (spell.to === null || day < spell.to),
  );
  if (inForce) return inForce.schedule;

  if (day < spells[0].from) return spells[0].schedule;
  return assignment.schedule;
}

/**
 * One report row: a lesson, one teacher, and the days of it that were theirs.
 *
 * Extracted because it is now called once per responsible teacher rather than once
 * per lesson, and the two callers must not drift — the counts on a stand-in's row
 * and on the row of the teacher they covered for come out of the same arithmetic
 * or the report stops adding up.
 *
 * `entries` and `studentsNoted` come off `perDay` when the row is a share of the
 * lesson rather than the whole of it. Without `perDay` a shared row falls back to
 * counting the days written on, which is exactly what the roll call's own totals
 * already are, and leaves `studentsNoted` at zero rather than inventing a split of
 * a number that cannot be divided.
 */
function buildRow(
  meta: Omit<CoverageAssignment, 'schedule'>,
  who: LessonSubstitute,
  days: Date[],
  periodsOn: (day: Date) => number,
  asOf: Date,
  entry: CoverageWritten | undefined,
  rule: CoverageRule,
  attribution: { isSubstitute: boolean; split: boolean; ownerName: string },
): CoverageRow {
  const lessonsTimetabled = days.reduce((total, day) => total + periodsOn(day), 0);
  const elapsed = days.filter((day) => day <= asOf);
  const lessonsElapsed = elapsed.reduce((total, day) => total + periodsOn(day), 0);
  const lessonDates = elapsed.map(weekKey);

  const writtenOn = new Set(entry?.dates ?? []);
  const missingDates = lessonDates.filter((date) => !writtenOn.has(date));

  // Whose entries these are. Unsplit, they are the lesson's own totals — the
  // report as it stood. Split, only the days this teacher held count, including
  // days still ahead of `asOf`: under `anyEntry` a register filed early is filed.
  const mine = new Set(days.map(weekKey));
  const perDay = entry?.perDay?.filter((day) => mine.has(day.date));
  const entries = !attribution.split
    ? (entry?.entries ?? 0)
    : perDay
      ? perDay.reduce((total, day) => total + day.entries, 0)
      : [...writtenOn].filter((date) => mine.has(date)).length;
  const studentsNoted = !attribution.split
    ? (entry?.studentsNoted ?? 0)
    : (perDay?.reduce((total, day) => total + day.studentsNoted, 0) ?? 0);

  return {
    ...meta,
    teacherId: who.teacherId,
    teacherCode: who.teacherCode,
    teacherName: who.teacherName,
    lessonsTimetabled,
    lessonsElapsed,
    lessonDates,
    missingDates,
    entries,
    studentsNoted,
    lastDate: lastOf(
      attribution.split ? (entry?.dates ?? []).filter((date) => mine.has(date)) : entry?.dates,
    ),
    status: statusOf(rule, lessonsElapsed, entries, missingDates.length),
    ...(attribution.isSubstitute
      ? { isSubstitute: true, coveringForTeacherName: attribution.ownerName }
      : {}),
  };
}

/**
 * Which of the three states a row is in, under the rule the log is owed by.
 *
 * Nothing taught yet is `not_yet` under either rule — that is the state that
 * stops the report flagging the whole school on a Monday morning.
 *
 * Under `anyEntry`, an entry written for a lesson still ahead in the window (the
 * teacher filed early, or the timetable moved) still counts: the log has
 * something to show, which is the whole question being asked.
 */
function statusOf(
  rule: CoverageRule,
  lessonsElapsed: number,
  entries: number,
  missingDays: number,
): CoverageStatus {
  if (lessonsElapsed === 0) return 'not_yet';
  if (rule === 'everyLessonDay') return missingDays === 0 ? 'recorded' : 'missing';
  return entries > 0 ? 'recorded' : 'missing';
}

/** The last day written on — the dates are not assumed to arrive in order. */
function lastOf(dates: string[] | undefined): string | null {
  return dates?.length ? dates.reduce((latest, date) => (date > latest ? date : latest)) : null;
}

/** Gaps first — the report is read for what is wrong with it. */
function rank(status: CoverageStatus): number {
  return status === 'missing' ? 0 : status === 'recorded' ? 1 : 2;
}

/**
 * The same report with a different set of rows.
 *
 * Two narrowings want this and they want opposite things of the summary. Dropping
 * a colleague's share of a covered lesson has to take the summary with it, or the
 * headline describes rows the reader cannot see. Narrowing to the gaps
 * (`outstandingOnly`) deliberately keeps the window's own summary, because "3 of
 * 30 lessons unmarked" is the number being asked for and recomputing it would
 * always print "3 of 3". So the caller says which by passing a summary or not.
 */
export function withRows(
  report: LessonCoverage,
  rows: CoverageRow[],
  summary?: CoverageSummary,
): LessonCoverage {
  return { ...report, rows, summary: summary ?? summarize(rows) };
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
