import { AttendanceStatus } from 'src/common/constants/enums';
import { round2 } from '../term-results/grading';

/**
 * ວັນຂາດ — how the roll's five statuses become the two figures the school
 * actually reads: days absent with a reason, and days absent without one.
 *
 * Kept as a pure function so the rule is reviewable in one place and tested
 * without a database — it changes what is printed on the monthly sheet and the
 * report card, and feeds the rate that gates exam eligibility.
 *
 * The office's rules:
 *
 * - **ຂາດມີເຫດຜົນ** is any absence the school was told about. The roll files a
 *   sick day separately from an excused one, and every sheet has one column for
 *   both, so they are added here rather than by each reader.
 * - **ຂາດບໍ່ມີເຫດຜົນ** is an outright absence — plus one more for every
 *   `latesPerAbsence` late arrivals. Three lates are a day missed as far as the
 *   office is concerned, and are counted as one so a child who is never marked
 *   absent but always walks in late is not reported with a clean record.
 * - The lates that have not yet made up an absence stay as lates; a student
 *   late four times is one day absent and one time late, not one and four.
 * - The rate follows the same view: a late that has become an absence is no
 *   longer "accounted for", so the rate drops as the office would drop it.
 */
export const DEFAULT_LATES_PER_ABSENCE = 3;

/** The setting the office may tune the rule under; `DEFAULT_LATES_PER_ABSENCE` without it. */
export const LATES_PER_ABSENCE_SETTING = 'attendance.latesPerAbsence';

export type StatusCounts = Record<AttendanceStatus, number>;

export interface AbsenceDays {
  /** Absences made up of late arrivals: `floor(late / latesPerAbsence)`. */
  lateAsAbsent: number;
  /** Lates left over once the absences are taken out — what still reads as "late". */
  lateRemainder: number;
  /** ຂາດບໍ່ມີເຫດຜົນ: outright absences plus those made of lates. */
  absentUnexcused: number;
  /** ຂາດມີເຫດຜົນ: excused and sick together. */
  absentExcused: number;
  /** Both kinds of absence, which the sheets print as ລວມ. */
  absentTotal: number;
  /** The rule as applied, so a reader can explain the figures without knowing the setting. */
  latesPerAbsence: number;
  /** Present + late + excused + sick, less the lates that became absences, over total recorded. */
  attendanceRate: number;
}

/** A rule of 0 or less would divide by nothing; it is read as "lates never convert". */
export function normalizeLatesPerAbsence(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_LATES_PER_ABSENCE;
}

export function absenceDays(
  counts: StatusCounts,
  latesPerAbsence: number = DEFAULT_LATES_PER_ABSENCE,
): AbsenceDays {
  const lateAsAbsent = Math.floor(counts.late / latesPerAbsence);
  const lateRemainder = counts.late - lateAsAbsent * latesPerAbsence;
  const absentUnexcused = counts.absent + lateAsAbsent;
  const absentExcused = counts.excused + counts.sick;
  const totalRecorded = counts.present + counts.absent + counts.late + counts.excused + counts.sick;
  const accountedFor = totalRecorded - absentUnexcused;

  return {
    lateAsAbsent,
    lateRemainder,
    absentUnexcused,
    absentExcused,
    absentTotal: absentUnexcused + absentExcused,
    latesPerAbsence,
    attendanceRate: totalRecorded > 0 ? round2((accountedFor / totalRecorded) * 100) : 0,
  };
}
