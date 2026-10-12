import type { HomeroomAnomalyKind, HomeroomAnomalyScope } from '../constants/enums';

/**
 * Which children the homeroom teacher is shown, and why.
 *
 * The point of the twice-weekly review is that a problem reaches the guardian
 * while it is still small, and the thing that defeats that on paper is volume: a
 * teacher handed four screens and forty names checks the class once and never
 * again. So the sheet is a shortlist, and this file is the rule that builds it.
 *
 * Two scopes, deliberately both:
 *
 * - **window** — what happened since the last review. This is what the Wednesday
 *   check is for: two absences this week is the thing a phone call still fixes.
 * - **term** — where the child now stands. A child absent once a fortnight never
 *   trips a window rule and is failing the year by February, which is exactly the
 *   case the office says it keeps finding out about too late.
 *
 * A child may be flagged by either, and the reasons say which — a teacher reads
 * "ອາທິດນີ້ຂາດ 2 ວັນ" and "ລວມພາກຮຽນ 14 ວັນ" very differently.
 *
 * Pure, and free of Mongoose: the service reads the three summaries the system
 * already computes and hands them in.
 */

export interface ReviewThresholdSet {
  /** ວັນຂາດ (unexcused, three lates counted as a day) at or above which to flag. */
  absentDays: number;
  /** Late arrivals at or above which to flag, before any became an absence. */
  lates: number;
  /** Register entries carrying an action, at or above which to flag. */
  behaviorEntries: number;
}

export interface ReviewThresholds {
  /** Applied to the days since the last review. */
  window: ReviewThresholdSet;
  /** Applied to the term to date. */
  term: ReviewThresholdSet & {
    /** Attendance rate below which to flag, 0–100. */
    attendanceRateBelow: number;
    /** Conduct points remaining below which to flag — out of the year's 100. */
    conductPointsBelow: number;
  };
}

/**
 * The school has not set these yet, so they are a starting point and not policy.
 *
 * Chosen to put roughly a handful of names on a class sheet rather than half the
 * room: a sheet that flags everyone is the same as a sheet that flags nobody.
 * They live in settings (`homeroomReview.thresholds`) so the office can retune
 * them without a deploy — and once the office says what it wants, these defaults
 * stop mattering.
 *
 * `absentDays: 1` for the window is not an accident: one unexplained day, noticed
 * on Wednesday, is the whole reason this review exists.
 */
export const DEFAULT_REVIEW_THRESHOLDS: ReviewThresholds = {
  window: { absentDays: 1, lates: 2, behaviorEntries: 1 },
  term: {
    absentDays: 5,
    lates: 6,
    behaviorEntries: 3,
    attendanceRateBelow: 85,
    conductPointsBelow: 85,
  },
};

/** One child on the roll, as the sheet names them. */
export interface RosterEntry {
  studentId: string;
  studentCode: string | null;
  studentNameLo: string | null;
  /** What the class calls them — how a teacher recognises the row. */
  studentNickname: string | null;
  rollNumber: number | null;
}

/** The roll call's reading of one child, over whichever stretch was asked for. */
export interface AttendanceFacts {
  studentId: string;
  /** ຂາດບໍ່ມີເຫດຜົນ — absences outright plus the ones made of lates. */
  absentUnexcused: number;
  /** Every late arrival, before any became an absence. */
  late: number;
  /** Excused and sick — counted, never flagged: a sick note is not a problem to chase. */
  absentExcused: number;
  attendanceRate: number;
  totalRecorded: number;
}

/** The behaviour register's reading of one child. */
export interface BehaviorFacts {
  studentId: string;
  entries: number;
  /** Entries where the teacher wrote down an action, not a bare observation. */
  withAction: number;
  lastDate: string | null;
}

/** The discipline ledger's reading of one child, over the year. */
export interface ConductFacts {
  studentId: string;
  deducted: number;
  /** What is left of the year's 100. */
  remaining: number;
}

export interface AnomalyReason {
  kind: HomeroomAnomalyKind;
  scope: HomeroomAnomalyScope;
  value: number;
  threshold: number;
}

export interface FlaggedStudent extends RosterEntry {
  reasons: AnomalyReason[];
  /**
   * `act` when the term has something to say about this child, `watch` when only
   * the last few days do.
   *
   * The distinction is what the teacher triages on: a child two days absent this
   * week is a phone call, a child at fourteen days for the term is a meeting.
   */
  severity: 'watch' | 'act';
  /** The counts behind the reasons, so the sheet can show them without a second read. */
  window: Pick<AttendanceFacts, 'absentUnexcused' | 'late' | 'absentExcused'> & {
    behaviorEntries: number;
    behaviorWithAction: number;
  };
  term: Pick<AttendanceFacts, 'absentUnexcused' | 'late' | 'absentExcused' | 'attendanceRate'> & {
    behaviorEntries: number;
    behaviorWithAction: number;
    conductRemaining: number | null;
  };
}

const byId = <T extends { studentId: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.studentId, row]));

const EMPTY_ATTENDANCE: Omit<AttendanceFacts, 'studentId'> = {
  absentUnexcused: 0,
  late: 0,
  absentExcused: 0,
  attendanceRate: 100,
  totalRecorded: 0,
};

const EMPTY_BEHAVIOR: Omit<BehaviorFacts, 'studentId'> = {
  entries: 0,
  withAction: 0,
  lastDate: null,
};

/**
 * The shortlist, worst first.
 *
 * Every input is keyed by student and may simply be missing a child — the roll
 * call returns only the students it has something recorded against, and the
 * register returns only the ones written about, which is the good outcome. A
 * child absent from all three is a clean child, and is not on the sheet.
 *
 * A term reason with nothing new this week still flags: that is the slow slide
 * the office asked to be able to see.
 */
export function flagStudents(input: {
  roster: RosterEntry[];
  window: { attendance: AttendanceFacts[]; behavior: BehaviorFacts[] };
  term: {
    attendance: AttendanceFacts[];
    behavior: BehaviorFacts[];
    conduct: ConductFacts[];
  };
  thresholds?: ReviewThresholds;
}): FlaggedStudent[] {
  const thresholds = input.thresholds ?? DEFAULT_REVIEW_THRESHOLDS;

  const windowAttendance = byId(input.window.attendance);
  const windowBehavior = byId(input.window.behavior);
  const termAttendance = byId(input.term.attendance);
  const termBehavior = byId(input.term.behavior);
  const termConduct = byId(input.term.conduct);

  const flagged: FlaggedStudent[] = [];

  for (const student of input.roster) {
    const wAtt = windowAttendance.get(student.studentId) ?? EMPTY_ATTENDANCE;
    const wBeh = windowBehavior.get(student.studentId) ?? EMPTY_BEHAVIOR;
    const tAtt = termAttendance.get(student.studentId) ?? EMPTY_ATTENDANCE;
    const tBeh = termBehavior.get(student.studentId) ?? EMPTY_BEHAVIOR;
    const tCon = termConduct.get(student.studentId) ?? null;

    const reasons: AnomalyReason[] = [];
    const flag = (
      kind: HomeroomAnomalyKind,
      scope: HomeroomAnomalyScope,
      value: number,
      threshold: number,
    ) => {
      if (threshold > 0 && value >= threshold) reasons.push({ kind, scope, value, threshold });
    };

    flag('absence', 'window', wAtt.absentUnexcused, thresholds.window.absentDays);
    flag('late', 'window', wAtt.late, thresholds.window.lates);
    flag('behavior', 'window', wBeh.withAction, thresholds.window.behaviorEntries);

    flag('absence', 'term', tAtt.absentUnexcused, thresholds.term.absentDays);
    flag('late', 'term', tAtt.late, thresholds.term.lates);
    flag('behavior', 'term', tBeh.withAction, thresholds.term.behaviorEntries);

    // A rate is only a fact once the roll has been taken a few times: at two
    // lessons recorded, one absence reads as 50% and would flag the whole class
    // in the first week of every term.
    if (
      tAtt.totalRecorded >= 5 &&
      thresholds.term.attendanceRateBelow > 0 &&
      tAtt.attendanceRate < thresholds.term.attendanceRateBelow
    ) {
      reasons.push({
        kind: 'attendance_rate',
        scope: 'term',
        value: tAtt.attendanceRate,
        threshold: thresholds.term.attendanceRateBelow,
      });
    }

    // Conduct runs on the year's 100 and is read the other way round — below the
    // line rather than above it.
    if (
      tCon &&
      thresholds.term.conductPointsBelow > 0 &&
      tCon.remaining < thresholds.term.conductPointsBelow
    ) {
      reasons.push({
        kind: 'conduct',
        scope: 'term',
        value: tCon.remaining,
        threshold: thresholds.term.conductPointsBelow,
      });
    }

    if (reasons.length === 0) continue;

    flagged.push({
      ...student,
      reasons,
      severity: reasons.some((reason) => reason.scope === 'term') ? 'act' : 'watch',
      window: {
        absentUnexcused: wAtt.absentUnexcused,
        late: wAtt.late,
        absentExcused: wAtt.absentExcused,
        behaviorEntries: wBeh.entries,
        behaviorWithAction: wBeh.withAction,
      },
      term: {
        absentUnexcused: tAtt.absentUnexcused,
        late: tAtt.late,
        absentExcused: tAtt.absentExcused,
        attendanceRate: tAtt.attendanceRate,
        behaviorEntries: tBeh.entries,
        behaviorWithAction: tBeh.withAction,
        conductRemaining: tCon?.remaining ?? null,
      },
    });
  }

  // `act` before `watch`, then by how much is wrong, then by the roll so two
  // equal rows do not swap places between two reads of the same sheet.
  const weight = (row: FlaggedStudent) =>
    row.term.absentUnexcused * 3 + row.window.absentUnexcused * 2 + row.term.behaviorWithAction;

  return flagged.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'act' ? -1 : 1) ||
      weight(b) - weight(a) ||
      (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999),
  );
}

/**
 * The thresholds as stored, tolerating a partial or malformed settings row.
 *
 * Settings are editable through the API, so the value that comes back can be
 * anything. A missing key falls back to the default rather than to zero: zero
 * reads as "flag everyone" in three of these fields and as "flag nobody" in the
 * other two, and neither is what an empty box means.
 */
export function normalizeThresholds(value: unknown): ReviewThresholds {
  const source = (value ?? {}) as Partial<{
    window: Partial<ReviewThresholdSet>;
    term: Partial<ReviewThresholds['term']>;
  }>;

  const positive = (candidate: unknown, fallback: number): number =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : fallback;

  const { window: w, term: t } = DEFAULT_REVIEW_THRESHOLDS;
  return {
    window: {
      absentDays: positive(source.window?.absentDays, w.absentDays),
      lates: positive(source.window?.lates, w.lates),
      behaviorEntries: positive(source.window?.behaviorEntries, w.behaviorEntries),
    },
    term: {
      absentDays: positive(source.term?.absentDays, t.absentDays),
      lates: positive(source.term?.lates, t.lates),
      behaviorEntries: positive(source.term?.behaviorEntries, t.behaviorEntries),
      attendanceRateBelow: positive(source.term?.attendanceRateBelow, t.attendanceRateBelow),
      conductPointsBelow: positive(source.term?.conductPointsBelow, t.conductPointsBelow),
    },
  };
}

export const REVIEW_THRESHOLDS_SETTING = 'homeroomReview.thresholds';

/**
 * `yyyy-MM-dd` — the first day a homeroom review was owed.
 *
 * The school's go-live date, so a term already under way is not reported as
 * months behind on the day the screen appears. Empty means "count the whole
 * term".
 */
export const REVIEW_START_DATE_SETTING = 'homeroomReview.startDate';
