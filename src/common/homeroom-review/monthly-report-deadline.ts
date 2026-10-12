/**
 * When ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ is owed, and how a room stands against it.
 *
 * The office's rule: a month's report is handed in **by the 5th of the next
 * month**. One sent on the 6th is still received — the report is wanted either
 * way — but it is marked late, and the mark stays: lateness is judged on the
 * first time the report was sent, so amending it afterwards neither clears nor
 * worsens it.
 *
 * "By the 5th" is read in Vientiane time, to the end of that day: a teacher
 * sending at 23:00 on the 5th is on time. The report may be sent from the last
 * day of the month itself — earlier than that, the month's own figures are not
 * finished.
 *
 * Pure, so the boundary cases are tested without a clock or a database.
 */

/** The day of the following month the report is due by. */
export const REPORT_DUE_DAY = 5;

/** Vientiane is UTC+7 all year; there is no daylight saving to account for. */
const VIENTIANE_OFFSET_MS = 7 * 60 * 60 * 1000;

export type MonthlyReportStatus =
  /** Sent by the deadline. */
  | 'submitted'
  /** Sent, but after the deadline. */
  | 'late'
  /** Not sent, and the deadline has passed. */
  | 'missing'
  /** Not sent, and there is still time — the month is running or the 5th has not come. */
  | 'pending';

/** The instant the report for `year`/`month` (1–12) stops being on time. */
export function reportDeadline(year: number, month: number): Date {
  // Midnight at the start of the 6th in Vientiane — the end of the 5th.
  return new Date(Date.UTC(year, month, REPORT_DUE_DAY + 1) - VIENTIANE_OFFSET_MS);
}

/** The first instant the report may be sent: the start of the month's last day, Vientiane time. */
export function reportOpensAt(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0) - VIENTIANE_OFFSET_MS);
}

/** The deadline as a calendar date, for screens — `2026-11-05` for October. */
export function reportDueDate(year: number, month: number): string {
  return new Date(Date.UTC(year, month, REPORT_DUE_DAY)).toISOString().slice(0, 10);
}

export function reportStatus(
  year: number,
  month: number,
  submittedAt: Date | null | undefined,
  now: Date,
): MonthlyReportStatus {
  const deadline = reportDeadline(year, month);
  if (submittedAt) return submittedAt < deadline ? 'submitted' : 'late';
  return now < deadline ? 'pending' : 'missing';
}

/** Whole days past the deadline a report was sent (or has been outstanding), 0 when on time. */
export function daysLate(
  year: number,
  month: number,
  submittedAt: Date | null | undefined,
  now: Date,
): number {
  const deadline = reportDeadline(year, month).getTime();
  const at = (submittedAt ?? now).getTime();
  return at < deadline ? 0 : Math.floor((at - deadline) / 86_400_000) + 1;
}
