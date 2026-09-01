import { CURRENT_ROLL_STUDENT_STATUSES } from 'src/common/constants/enums';
import { STUDENT_NAME_SELECT } from './student-name';

/**
 * Who belongs on a roster, as opposed to who has an enrollment row.
 *
 * The two are not the same. A student's status and their enrollment's status are
 * kept apart on purpose — the enrollment records a placement in a classroom, the
 * student records whether the school is still teaching them — and the office
 * changes the first without touching the second. So a child who dropped out,
 * moved away or was suspended keeps an `active` enrollment until someone closes
 * it, and every screen that reads the class off enrollments alone goes on calling
 * their name.
 *
 * Roll call and the behaviour register are exactly those screens, so they filter
 * the roster down to the current roll: `active`, plus `no_certificate`, which
 * says something about a certificate and nothing about whether the child is in
 * the room.
 *
 * Records already written are left alone — a log of what happened is not a
 * roster, and a student who has since left was in class on the day.
 */

/** `select` for a roster populate: the name fields, plus the status filtered on. */
export const ROSTER_STUDENT_SELECT = `${STUDENT_NAME_SELECT} status`;

/** The same field for an aggregation `$project`. */
export const ROSTER_STUDENT_PROJECTION = { status: 1 } as const;

export function isCurrentRollStatus(status: unknown): boolean {
  return (CURRENT_ROLL_STUDENT_STATUSES as readonly string[]).includes(status as string);
}

/**
 * Whether a populated `studentId` ref names a student on the current roll.
 *
 * An unpopulated ref, or one whose student record has gone, carries no status to
 * judge by — the enrollment is then the only evidence there is, so the row is
 * kept rather than silently dropped off the sheet.
 */
export function isOnCurrentRoll(ref: unknown): boolean {
  const status = (ref as { status?: unknown } | null | undefined)?.status;
  if (status === undefined || status === null) return true;
  return isCurrentRollStatus(status);
}

/**
 * Whether a populated `studentId` ref names a student who is actually studying.
 *
 * The current roll minus one status: `no_certificate`. That child finished the
 * year and declined the certificate, so they still belong on a roster and in the
 * behaviour register, but the office rules they have no term left to sit — only
 * ກຳລັງຮຽນ takes an exam and earns a mark. The mark sheets are drawn from this
 * narrower list; every other roster screen keeps the wider one.
 *
 * Reads an unpopulated ref the same way `isOnCurrentRoll` does: no status to
 * judge by means the row is kept rather than silently dropped.
 */
export function isStudying(ref: unknown): boolean {
  const status = (ref as { status?: unknown } | null | undefined)?.status;
  if (status === undefined || status === null) return true;
  return status === 'active';
}
