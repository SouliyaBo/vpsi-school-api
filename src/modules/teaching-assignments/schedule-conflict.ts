import { SchedulePeriod } from 'src/database/schemas';

export type ConflictKind = 'teacher' | 'classroom' | 'room';

export interface ScheduleConflict {
  kind: ConflictKind;
  assignmentId: string;
  dayOfWeek: number;
  existing: { startTime: string; endTime: string; room?: string | null };
  requested: { startTime: string; endTime: string; room?: string | null };
  /**
   * One side declared a swap and the other did not.
   *
   * The half-marked case is the one a human is most likely to hit and least
   * likely to work out: they tick the new lesson, and it is refused by an older
   * one recorded before the tick existed. Naming it lets the refusal say which
   * lesson to go and tick, instead of insisting the teacher is double-booked.
   */
  rotationMismatch: boolean;
}

/**
 * Whether two periods on the same day overlap.
 *
 * Uses strict inequalities so back-to-back periods (08:00–08:50 and 08:50–09:40)
 * do *not* conflict — the end of one is the start of the next, which is the
 * normal timetable pattern.
 *
 * Zero-padded `HH:mm` strings compare lexicographically in chronological order,
 * so no parsing is needed.
 */
export function periodsOverlap(a: SchedulePeriod, b: SchedulePeriod): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

/**
 * Whether an overlap between these two periods is the school's own swap rather
 * than a clash.
 *
 * Both sides must be marked. A rotating period still clashes with an ordinary
 * lesson, which is what stops one tick from quietly parking a second class on
 * top of a real one — the exemption only holds where both timetable entries
 * agree they are taking turns.
 */
export function sharesRotation(a: SchedulePeriod, b: SchedulePeriod): boolean {
  return a.isRotating === true && b.isRotating === true;
}

/**
 * Finds every scheduling conflict between a requested schedule and the
 * assignments already in place for the same semester.
 *
 * Three independent constraints, all of which must hold:
 *
 * - **teacher** — a teacher can only be in one place at a time
 * - **classroom** — a class of students can only attend one lesson at a time
 * - **room** — a physical room holds one lesson at a time (skipped when either
 *   side leaves `room` unset, since an unspecified room says nothing)
 *
 * All three are waived between two periods that both declare themselves part of
 * a swap — see `sharesRotation`. They are waived together because a swap
 * produces all three at once: the arrangements it alternates between use the
 * same teachers, the same classes and the same rooms.
 *
 * `existingAssignments` must already exclude the assignment being updated;
 * otherwise it conflicts with itself.
 */
export function findScheduleConflicts(
  requested: {
    teacherId: string;
    classroomId: string;
    schedule: SchedulePeriod[];
  },
  existingAssignments: {
    id: string;
    teacherId: string;
    classroomId: string;
    schedule: SchedulePeriod[];
  }[],
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (const period of requested.schedule) {
    for (const other of existingAssignments) {
      for (const otherPeriod of other.schedule) {
        if (!periodsOverlap(period, otherPeriod)) continue;
        if (sharesRotation(period, otherPeriod)) continue;

        const kinds: ConflictKind[] = [];
        if (other.teacherId === requested.teacherId) kinds.push('teacher');
        if (other.classroomId === requested.classroomId) kinds.push('classroom');
        if (period.room && otherPeriod.room && period.room === otherPeriod.room) {
          kinds.push('room');
        }

        // Both marked is exempt and never reaches here, so one marked means
        // exactly one — the half-declared swap.
        const rotationMismatch = period.isRotating === true || otherPeriod.isRotating === true;

        for (const kind of kinds) {
          conflicts.push({
            kind,
            rotationMismatch,
            assignmentId: other.id,
            dayOfWeek: period.dayOfWeek,
            existing: {
              startTime: otherPeriod.startTime,
              endTime: otherPeriod.endTime,
              room: otherPeriod.room ?? null,
            },
            requested: {
              startTime: period.startTime,
              endTime: period.endTime,
              room: period.room ?? null,
            },
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Catches a schedule that conflicts with itself, e.g. two overlapping own periods.
 *
 * `isRotating` grants no exemption here, and must not: a swap alternates between
 * *different* assignments, while these two periods are one teacher taking one
 * subject with one class — who cannot take turns with themselves.
 */
export function findSelfOverlaps(schedule: SchedulePeriod[]): [number, number][] {
  const overlaps: [number, number][] = [];
  for (let i = 0; i < schedule.length; i += 1) {
    for (let j = i + 1; j < schedule.length; j += 1) {
      if (periodsOverlap(schedule[i], schedule[j])) overlaps.push([i, j]);
    }
  }
  return overlaps;
}
