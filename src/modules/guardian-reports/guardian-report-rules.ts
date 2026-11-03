/**
 * The rules behind a ລາຍງານຫາຜູ້ປົກຄອງ link — what the token is, what the phone
 * digits are checked against, and when a link stops working.
 *
 * Kept free of Mongoose and Nest, like `conduct-escalation.ts`, because this is
 * the part that decides whether a stranger holding a forwarded link sees a child's
 * marks, and that deserves tests that run on plain values.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Wrong phone digits a link survives. The fifth locks it; the teacher reissues. */
export const MAX_PIN_ATTEMPTS = 5;

/** How many trailing phone digits the guardian types. */
export const PIN_LENGTH = 4;

/** How long a link lives when the setting is absent or nonsense. */
export const DEFAULT_LINK_DAYS = 30;
export const MAX_LINK_DAYS = 180;
export const LINK_DAYS_SETTING = 'guardianReports.linkDays';

/** What a teacher may put in a report. The message is separate: free text, optional. */
export const GUARDIAN_REPORT_SECTIONS = [
  'monthlyMarks',
  'attendance',
  'conduct',
  'behavior',
] as const;
export type GuardianReportSection = (typeof GUARDIAN_REPORT_SECTIONS)[number];

/** A token is 32 random bytes, base64url — exactly 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new link token and the hash that is stored in its place.
 *
 * 256 bits from the OS's CSPRNG, so the token is the part nobody can guess and
 * the phone digits are only the part a forwarded link lacks.
 */
export function issueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/**
 * SHA-256, hex. Unsalted on purpose: the input is 256 random bits, so there is
 * no dictionary to precompute, and an unsalted hash is what makes the lookup a
 * single indexed equality.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check, so a malformed token never reaches the database. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * The digits a guardian's phone opens a report with, or `null` when the number
 * on file is too short to have any.
 *
 * Digits only, so `020 5555 1234`, `+856 20 55551234` and `02055551234` all
 * answer `1234` — the office has typed numbers every way there is.
 */
export function phonePin(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= PIN_LENGTH ? digits.slice(-PIN_LENGTH) : null;
}

/** Whether what the guardian typed is their phone's last digits. Constant-time. */
export function pinMatches(entered: string, phone: string | null | undefined): boolean {
  const expected = phonePin(phone);
  if (!expected) return false;
  const given = entered.replace(/\D/g, '');
  if (given.length !== PIN_LENGTH) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export type GuardianReportState = 'active' | 'expired' | 'revoked' | 'locked';

/**
 * Where a link stands. Revoked outranks locked outranks expired: each is a more
 * deliberate act than the next, and the teacher's list should name the one
 * somebody chose over the one that merely happened.
 */
export function reportState(
  report: { expiresAt: Date; revokedAt?: Date | null; lockedAt?: Date | null },
  now: Date,
): GuardianReportState {
  if (report.revokedAt) return 'revoked';
  if (report.lockedAt) return 'locked';
  if (report.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** The `guardianReports.linkDays` setting, made safe to add to a date. */
export function normalizeLinkDays(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_LINK_DAYS
    ? value
    : DEFAULT_LINK_DAYS;
}

export function linkExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * The days of `month` that fall inside a term, as inclusive UTC midnights — or
 * `null` when the term does not reach that month at all.
 *
 * A term names its months by number only (`grading.semesterMonths`), and the
 * first term runs September into January, so which *year* a month belongs to is
 * whichever one puts it inside the term. Clipped to the term at both ends: the
 * report for September of a term that opens on the 17th is the 17th onwards.
 */
export function monthWindow(
  term: { startDate: Date; endDate: Date },
  month: number,
): { from: Date; to: Date } | null {
  const start = utcMidnight(term.startDate);
  const end = utcMidnight(term.endDate);

  for (
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    cursor <= end;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  ) {
    if (cursor.getUTCMonth() + 1 !== month) continue;
    const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    return { from: cursor < start ? start : cursor, to: last > end ? end : last };
  }
  return null;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ── What the guardian sees ──────────────────────────────────────────────────

/**
 * The stored report. Deliberately thin on identity: a name, a room, a month. No
 * student code, no address, no phone numbers, no photo — nothing on this page
 * is any use to someone who was never meant to open it beyond the marks
 * themselves.
 */
export interface GuardianReportSnapshot {
  student: { nameLo: string; nickname: string | null };
  classroomName: string;
  semester: { number: number; nameLo: string | null };
  month: number;
  /** `yyyy-MM-dd` bounds of the month inside the term. */
  window: { from: string; to: string };
  /** The room's homeroom teacher — the person the family knows. */
  teacherName: string;
  /** Who pressed send: the homeroom teacher, or the office on their behalf. */
  sentBy: 'homeroom' | 'office';
  guardian: { nameLo: string; relationship: string };
  sections: GuardianReportSection[];
  /**
   * The month as the parent letter prints it: ລວມ and ກວດກາ per subject, with no
   * full marks beside them and no ລຳດັບ — the school chose (28 Oct 2026) not to
   * send a family where their child stands against the class.
   */
  monthlyMarks?: {
    subjects: {
      nameLo: string;
      nameEn: string | null;
      score: number | null;
      /** ກວດກາ on its own, as the class summary derives it. */
      test: number | null;
      grade: string | null;
    }[];
    total: number | null;
    average: number | null;
    grade: string | null;
    isComplete: boolean;
  };
  attendance?: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    sick: number;
    totalRecorded: number;
    absentUnexcused: number;
    absentExcused: number;
    latesPerAbsence: number;
    attendanceRate: number;
  };
  conduct?: {
    baseScore: number;
    remaining: number;
    grade: string | null;
    /** Points taken this month, oldest first. */
    deductions: { date: string; ruleNameLo: string; points: number }[];
  };
  behavior?: {
    date: string;
    subjectNameLo: string | null;
    behavior: string | null;
    action: string | null;
    remark: string | null;
  }[];
  message: string | null;
  generatedAt: string;
}
