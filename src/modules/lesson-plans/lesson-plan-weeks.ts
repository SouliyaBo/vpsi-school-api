/**
 * Weeks and deadlines for lesson plans.
 *
 * The compliance matrix compares what *should* exist against what does, and
 * both halves have to agree on what "week 3" means. That agreement lives here:
 * every plan is snapped to the Monday of its week on write, and the matrix
 * derives its columns from the same function — so a lookup is an exact date
 * match rather than a range scan that can miss by a day.
 */

const MS_PER_DAY = 86_400_000;

/** Deadline policy, read from the `lessonPlans.submissionPolicy` setting. */
export interface LessonPlanPolicy {
  /**
   * Days before the taught week begins that the plan is due.
   *
   * `3` with a Monday week start means the preceding Friday — which is how the
   * school actually runs it: plans for next week are handed in before this week
   * ends.
   */
  daysBeforeWeekStart: number;
  /** Local wall-clock `"HH:mm"` the deadline falls at. */
  dueTime: string;
}

export const DEFAULT_LESSON_PLAN_POLICY: LessonPlanPolicy = {
  daysBeforeWeekStart: 3,
  dueTime: '16:00',
};

/** Collapses a timestamp to UTC midnight — a week is a calendar span, not an instant. */
export function toUtcMidnight(input: string | Date): Date {
  const date = new Date(input);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The Monday of the week containing `input`, at UTC midnight.
 *
 * Monday rather than Sunday because the school week is Monday–Friday
 * (`schedule.teachingDays` is `[1,2,3,4,5]`), so a Sunday-anchored week would
 * put a Sunday-dated plan in the week before the one it is actually for.
 */
export function startOfWeek(input: string | Date): Date {
  const date = toUtcMidnight(input);
  // getUTCDay(): 0 = Sunday. Sunday belongs to the week that just ended, so it
  // steps back 6 days rather than 0.
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * MS_PER_DAY);
}

/** The Sunday closing the week that `weekStartDate` opens. */
export function endOfWeek(weekStartDate: Date): Date {
  return new Date(weekStartDate.getTime() + 6 * MS_PER_DAY);
}

/** Stable key for a date used as a map key or a matrix column. */
export function weekKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * When a plan for `weekStartDate` is due.
 *
 * Derived, never accepted from the client: a teacher who names their own
 * deadline is never late, and `isLate` would then measure nothing.
 */
export function deriveDueDate(weekStartDate: Date, policy: LessonPlanPolicy): Date {
  const [hours, minutes] = policy.dueTime.split(':').map(Number);
  const due = new Date(weekStartDate.getTime() - policy.daysBeforeWeekStart * MS_PER_DAY);
  due.setUTCHours(hours, minutes, 0, 0);
  return due;
}

export interface SemesterWeek {
  /** 1-based, as the school counts them. */
  index: number;
  /** Monday, UTC midnight — the value stored on the plan. */
  startDate: Date;
  endDate: Date;
}

/**
 * Every teaching week in a semester.
 *
 * The first week is the one containing the semester's start date, even when the
 * term begins mid-week: a term that opens on a Wednesday still has a "week 1"
 * that teachers file a plan for.
 */
export function buildSemesterWeeks(startDate: Date, endDate: Date): SemesterWeek[] {
  const weeks: SemesterWeek[] = [];
  const last = toUtcMidnight(endDate);

  let cursor = startOfWeek(startDate);
  let index = 1;

  // Guarded rather than `while (true)`: a semester with a corrupt end date
  // before its start must yield nothing, not spin.
  while (cursor <= last && index <= 60) {
    weeks.push({ index, startDate: cursor, endDate: endOfWeek(cursor) });
    cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY);
    index += 1;
  }

  return weeks;
}
