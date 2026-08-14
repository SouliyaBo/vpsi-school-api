import { Model } from 'mongoose';
import { SchoolYearDocument, TeacherDocument } from 'src/database/schemas';

/**
 * How a teacher code is built: `T-2627-001`.
 *
 * `T` for teacher, `2627` for the academic year 2026-2027, then a serial within
 * that year. The year is part of the code so a code says *when* someone joined
 * without a lookup — the same shape the office already writes by hand.
 */
export const TEACHER_CODE_PREFIX = 'T';

/** Serial width. Three digits fits a school many times this one's size. */
const SERIAL_DIGITS = 3;

/**
 * `2026-2027` → `2627`.
 *
 * Takes the last two digits of each half. A code written any other way — a bare
 * `2026`, or a year named rather than numbered — yields `null` rather than a
 * mangled guess, so the caller can say so instead of minting `T-undefined-001`.
 */
export function schoolYearShortCode(code: string | null | undefined): string | null {
  const match = /(\d{4})\s*[-–/]\s*(\d{4})/.exec(code ?? '');
  if (!match) return null;
  return `${match[1].slice(2)}${match[2].slice(2)}`;
}

export function formatTeacherCode(yearShort: string, serial: number): string {
  return `${TEACHER_CODE_PREFIX}-${yearShort}-${String(serial).padStart(SERIAL_DIGITS, '0')}`;
}

/**
 * The next free serial for a year, read off the codes already issued.
 *
 * Derived from the collection rather than a counter document because the codes
 * *are* the record: a counter can drift out of step with a register that was
 * also edited by hand, and then hands out a number someone already has. Reading
 * the maximum cannot drift, and the unique index catches the one case this
 * misses — two writers racing — which `nextTeacherCode` retries.
 *
 * Soft-deleted teachers are counted. Reissuing a departed teacher's code would
 * make their historical lesson plans and timetables read as someone else's.
 */
export async function nextSerialForYear(
  teachers: Model<TeacherDocument>,
  yearShort: string,
): Promise<number> {
  const prefix = `${TEACHER_CODE_PREFIX}-${yearShort}-`;
  const highest = await teachers
    .find({ teacherCode: { $regex: `^${prefix}\\d+$` } })
    .select('teacherCode')
    .sort({ teacherCode: -1 })
    .limit(1)
    .lean()
    .exec();

  if (highest.length === 0) return 1;
  return Number(highest[0].teacherCode.slice(prefix.length)) + 1;
}

/**
 * The academic year a new teacher's code belongs to.
 *
 * The active year, which is what the office means by "this year". Falls back to
 * the latest year on file so a school between years can still add staff, and
 * returns `null` when there is no year at all — the caller decides whether that
 * is an error or a reason to ask for one.
 */
export async function resolveCodeYear(
  schoolYears: Model<SchoolYearDocument>,
): Promise<string | null> {
  const active = await schoolYears
    .findOne({ isActive: true, deletedAt: null })
    .select('code')
    .lean()
    .exec();
  if (active) return schoolYearShortCode(active.code);

  const latest = await schoolYears
    .findOne({ deletedAt: null })
    .select('code')
    .sort({ startDate: -1 })
    .lean()
    .exec();
  return latest ? schoolYearShortCode(latest.code) : null;
}

/**
 * Mints the next code for a year, retrying past a code taken mid-flight.
 *
 * `taken` lets a caller reserve codes it has decided on but not yet written —
 * an import assigns a whole file's worth before the first `create` lands, and
 * without it every row in the batch would be handed the same serial.
 */
export async function nextTeacherCode(
  teachers: Model<TeacherDocument>,
  yearShort: string,
  taken: Set<string> = new Set(),
): Promise<string> {
  let serial = await nextSerialForYear(teachers, yearShort);
  let code = formatTeacherCode(yearShort, serial);

  while (taken.has(code)) {
    serial += 1;
    code = formatTeacherCode(yearShort, serial);
  }

  return code;
}
