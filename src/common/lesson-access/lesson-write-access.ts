/**
 * Who may write a lesson up, and who is held responsible for it.
 *
 * One rule, in one place, because it is asked in four: the roll call and the
 * behaviour register both refuse a write against somebody else's lesson, the
 * register asks it a second time when a row is edited or withdrawn, and the
 * coverage and punctuality reports ask the same question in reverse — not "may
 * this teacher write it" but "which teacher was owed it". Those two have to agree
 * exactly. A teacher allowed to write a lesson who is not the one the report
 * chases leaves the day owed by somebody who was not there; the reverse leaves
 * the person who taught it locked out of a register they are being chased for.
 *
 * Kept free of Mongoose so the rules are unit-testable on plain objects, in the
 * spirit of `grading.ts` and `eligibility.ts`; the reads live in
 * `LessonAccessService`.
 */

/** The teacher who actually took a lesson, named well enough for a report row. */
export interface LessonSubstitute {
  teacherId: string;
  teacherCode: string | null;
  teacherName: string;
}

/**
 * Every substituted lesson-day in a window, keyed by `substitutionKey`.
 *
 * A flat map rather than a list, because both reports already walk
 * (assignment × day) and need an O(1) answer inside that loop, and because the
 * key is exactly the grain a claim is stored at — so there is no aggregation step
 * in between for the two reports to disagree in.
 */
export type SubstitutionIndex = ReadonlyMap<string, LessonSubstitute>;

/** `yyyy-MM-dd` of a UTC-midnight date — the form the reports key days by. */
export function dayKeyOf(date: Date | string): string {
  return date instanceof Date ? date.toISOString().slice(0, 10) : date.slice(0, 10);
}

/**
 * The index key for one lesson on one day.
 *
 * The same composite the punctuality report already keys its write-ups by, so a
 * claim, a write-up and a timetabled day all land on one string.
 */
export function substitutionKey(teachingAssignmentId: string, date: Date | string): string {
  return `${teachingAssignmentId}|${dayKeyOf(date)}`;
}

/** A timetabled lesson, as much of it as attribution needs. */
export interface AttributableLesson {
  teachingAssignmentId: string;
  teacherId: string;
  teacherCode: string | null;
  teacherName: string;
}

/**
 * The teacher who owes a lesson-day: the stand-in if there was one, the
 * timetabled teacher otherwise.
 *
 * This is the whole of the accountability transfer. Both reports run it per
 * (lesson, day), which is why a claim filed after the fact needs nothing to be
 * recomputed or back-filled: the reports never stored whose day it was, they
 * derive it, and the claim is simply part of what they read.
 */
export function responsibleTeacher(
  lesson: AttributableLesson,
  date: Date | string,
  substitutions?: SubstitutionIndex,
): LessonSubstitute {
  const stood = substitutions?.get(substitutionKey(lesson.teachingAssignmentId, date));
  if (stood) return stood;
  return {
    teacherId: lesson.teacherId,
    teacherCode: lesson.teacherCode,
    teacherName: lesson.teacherName,
  };
}

/**
 * The periods of a lesson that fall on the same weekday as `date`.
 *
 * `getUTCDay()` rather than `getDay()`: a stored school date has already been
 * collapsed to UTC midnight, so the local-time accessor would read the previous
 * day on any server west of UTC.
 *
 * Generic in the period, so this stays free of the schema while still handing back
 * the caller's own slots — the roll call reads `periodNumber` and `startTime` off
 * them to decide which period a record belongs to.
 *
 * Lives here rather than beside the roll call because it is half of the question
 * this file answers: a claim, a write and a report all have to agree on whether a
 * lesson was taught on a given day.
 */
export function periodsOnDate<T extends { dayOfWeek: number }>(schedule: T[], date: Date): T[] {
  return schedule.filter((period) => period.dayOfWeek === date.getUTCDay());
}

/**
 * An id however the caller holds it.
 *
 * Both callers hand this a Mongoose document — the timetable on a write, a stored
 * row on an edit — and `@Prop({ type: SchemaTypes.ObjectId })` means `===` against
 * a string id is always false. Comparing through `String` is the house rule, and
 * accepting the loose type here is what lets this file keep it without importing
 * Mongoose.
 */
type IdLike = string | { toString(): string };

/** Just enough of an actor to decide a write, so the rule needs no auth import. */
export interface LessonActor {
  personType?: string | null;
  personId?: string | null;
}

/**
 * May this actor write against this lesson on this day?
 *
 * Three ways in, and no fourth:
 *
 * 1. not being held to a timetable at all — an office account, whose resource
 *    permission is the whole of the policy. This is what makes recording on a
 *    teacher's behalf possible, and it is unchanged;
 * 2. being the teacher the timetable gives the lesson to;
 * 3. holding a live claim on *that day* of it.
 *
 * The third is deliberately narrow. A claim is one lesson on one date, so cover
 * for a Tuesday says nothing about the Wednesday, and nothing at all about
 * marking: `ScoresService.assertCanGrade` and `MonthlyMarksService.canEdit` check
 * the assignment rather than the day, and are meant to keep doing so. Standing in
 * for a colleague's lesson is not taking over their marking, and a day's cover
 * must never become a term's grades.
 *
 * The caller resolves the claim — see `LessonAccessService.liveSubstitution` —
 * rather than this taking a whole index, because a write concerns exactly one
 * lesson-day and reading the window around it would be work thrown away.
 */
export function canWriteLesson(
  lesson: { teacherId: IdLike },
  actor: LessonActor,
  substitute?: { substituteTeacherId: IdLike } | null,
): boolean {
  if (actor.personType !== 'teacher') return true;
  if (!actor.personId) return false;
  if (actor.personId === String(lesson.teacherId)) return true;
  return Boolean(substitute) && String(substitute!.substituteTeacherId) === actor.personId;
}
