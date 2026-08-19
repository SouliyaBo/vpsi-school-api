import { Types } from 'mongoose';

/**
 * How a student is named on a register.
 *
 * A homeroom teacher knows a child by what they are called, not by what the
 * register says, so every sheet, roster and tally carries the nickname next to
 * the register name. Kept here rather than repeated per module so a screen
 * cannot quietly go back to register names only.
 *
 * Deliberately *not* denormalized onto the enrollment alongside `studentNameLo`:
 * that field is a snapshot taken at placement, and a nickname is usually typed in
 * afterwards — a snapshot would be blank for exactly the children whose register
 * names nobody can remember.
 */

/** Mongoose `select` for the fields these helpers read. */
export const STUDENT_NAME_SELECT =
  'studentCode firstNameLo lastNameLo firstNameEn lastNameEn nickname nicknameEn';

/**
 * The same fields for an aggregation `$project`.
 *
 * The English halves of the register name are left out: an aggregated tally is
 * rendered from `studentNameLo` only, so projecting them would be dead weight on
 * every row.
 */
export const STUDENT_NAME_PROJECTION = {
  studentCode: 1,
  firstNameLo: 1,
  lastNameLo: 1,
  nickname: 1,
  nicknameEn: 1,
} as const;

export interface NamedStudent {
  _id?: Types.ObjectId;
  studentCode?: string | null;
  firstNameLo?: string | null;
  lastNameLo?: string | null;
  nickname?: string | null;
  nicknameEn?: string | null;
}

/** `ສົມຈິດ ວົງສາ`, or `null` when neither half is on file. */
export function registerName(student: NamedStudent | null | undefined): string | null {
  if (!student) return null;
  return [student.firstNameLo, student.lastNameLo].filter(Boolean).join(' ').trim() || null;
}

/**
 * The nickname in the register's own language, falling back to the English one.
 *
 * These sheets are Lao-only by design — they are printed and filed — so this
 * mirrors `studentNameLo` rather than offering both languages.
 */
export function nicknameOf(student: NamedStudent | null | undefined): string | null {
  if (!student) return null;
  return student.nickname?.trim() || student.nicknameEn?.trim() || null;
}

/**
 * Reads a populated `studentId` ref as the student it actually is.
 *
 * Mongoose types the field as the ref, so reaching the name fields on a populated
 * query needs this. Returns `null` when the ref was left unpopulated or points at
 * a student that no longer exists — a sheet still renders, minus the nickname.
 */
export function populatedStudent(ref: unknown): (NamedStudent & { _id: Types.ObjectId }) | null {
  if (!ref || typeof ref !== 'object' || ref instanceof Types.ObjectId) return null;
  const student = ref as NamedStudent & { _id?: Types.ObjectId };
  return student._id ? (student as NamedStudent & { _id: Types.ObjectId }) : null;
}
