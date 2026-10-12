import type {
  ConductEscalationLevel,
  GuardianContactChannel,
  HomeroomReviewAction,
} from '../constants/enums';

/**
 * ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ — the homeroom teacher's monthly report, pre-filled.
 *
 * The office's form asks the homeroom teacher, once a month, for a dozen lists
 * the system already holds: who was absent three days or more, whose lates made
 * up a day, who the register wrote up, who lost conduct points and how far up
 * the ladder that took them, whose ກວດກາ came in under the line, which guardians
 * were contacted. Copying those out of five screens by hand is the part of the
 * job that produces mistakes, so this file builds them from the same figures
 * those screens show, and the teacher is left with the parts only they know —
 * ສະພາບລວມ, ການຮຽນເພີ່ມ, ການເຄື່ອນໄຫວພາຍນອກ and ຂໍ້ສະເໜີ — which the export
 * prints as blank rows to be written in.
 *
 * Pure, and free of Mongoose: the service reads the facts and hands them in.
 */

/** The form's own line: "ເອົາຜູ້ທີ່ພົ້ນເດັ່ນໃນເດືອນນັ້ນໆ (ຂາດຮຽນ 3 ມື້ຂຶ້ນໄປ)". */
export const NOTABLE_ABSENCE_DAYS = 3;

/**
 * ຄາດໝາຍ for a ກວດກາ mark, as a share of what the column is out of.
 *
 * The form asks for "ເສັງຕົວຈິງໄດ້ຄະແນນຫຼຸດຄາດໝາຍ" without saying where the line
 * is. Half marks is the line every other part of the system passes at
 * (`PASSING_MARK`), so it is the line used here until the office names another.
 */
export const TEST_TARGET_RATIO = 0.5;

/**
 * The form's three levels of who dealt with a child — ຄູປະຈຳຫ້ອງ / ວິຊາການ /
 * ອຳນວຍການ — read off the rung of the rule sheet's ladder the child has reached.
 *
 * The ladder has more rungs than the form has columns: up to ຂັ້ນ 2 the homeroom
 * teacher is still the one the sheet names first, so those are theirs; ຂັ້ນ 2
 * brings in ຄະນະຄຸ້ມຄອງນັກຮຽນ, which the form's middle column stands for; ຂັ້ນ 3
 * and beyond go to the director.
 */
export const HANDLED_AT: Readonly<Record<ConductEscalationLevel, string | null>> = {
  none: null,
  classroom: 'ຄູປະຈຳຫ້ອງ',
  level1: 'ຄູປະຈຳຫ້ອງ',
  level2: 'ວິຊາການ',
  level3: 'ອຳນວຍການ',
  review: 'ອຳນວຍການ',
};

export const ESCALATION_LABEL_LO: Readonly<Record<ConductEscalationLevel, string>> = {
  none: 'ຍັງບໍ່ຮອດຂັ້ນລາຍງານ',
  classroom: 'ຂັ້ນຫ້ອງ',
  level1: 'ຂັ້ນ 1',
  level2: 'ຂັ້ນ 2',
  level3: 'ຂັ້ນ 3 (ຂັ້ນໂຮງຮຽນ)',
  review: 'ພິຈາລະນາການຮຽນຕໍ່',
};

export const CONTACT_CHANNEL_LO: Readonly<Record<GuardianContactChannel, string>> = {
  phone: 'ໂທລະສັບ',
  telegram: 'Telegram',
  in_person: 'ພົບໂດຍຕົງ',
  letter: 'ໜັງສືເຊີນ',
};

// ── Facts in ────────────────────────────────────────────────────────────────

export interface ReportStudent {
  studentId: string;
  studentCode: string | null;
  studentNameLo: string;
  rollNumber: number | null;
  isFemale: boolean;
}

/** One student's month on the roll, as `absenceDays` reads it. */
export interface AttendanceFact {
  studentId: string;
  late: number;
  lateAsAbsent: number;
  absentUnexcused: number;
  absentExcused: number;
  absentTotal: number;
}

/** A roll-call row that was not `present`, carrying what the teacher wrote. */
export interface AttendanceNote {
  studentId: string;
  status: 'absent' | 'late' | 'excused' | 'sick';
  reason: string | null;
}

export interface BehaviorEntry {
  studentId: string;
  date: string;
  behavior: string | null;
  action: string | null;
}

export interface DeductionEntry {
  studentId: string;
  date: string;
  ruleCode: string;
  ruleNameLo: string;
  points: number;
  note: string | null;
}

/** The year's points lost, before the month began and by its end. */
export interface ConductStanding {
  studentId: string;
  deductedBefore: number;
  deductedByEnd: number;
  levelBefore: ConductEscalationLevel;
  levelByEnd: ConductEscalationLevel;
}

export interface ReviewLine {
  studentId: string;
  dueDate: string;
  action: HomeroomReviewAction;
  contactChannel: GuardianContactChannel | null;
  note: string | null;
}

export interface TestSubject {
  id: string;
  nameLo: string;
  /** What ກວດກາ is out of for this subject — 6 unless it is marked otherwise. */
  testMax: number;
}

export interface TestRow {
  studentId: string;
  /** ກວດກາ per subject, in `subjects` order; `null` where none is written. */
  testScores: (number | null)[];
}

export interface MonthlyReportFacts {
  roster: ReportStudent[];
  attendance: AttendanceFact[];
  attendanceNotes: AttendanceNote[];
  behavior: BehaviorEntry[];
  deductions: DeductionEntry[];
  conduct: ConductStanding[];
  reviews: ReviewLine[];
  subjects: TestSubject[];
  tests: TestRow[];
}

// ── Report out ──────────────────────────────────────────────────────────────

export interface NamedRow {
  studentId: string;
  studentCode: string | null;
  studentNameLo: string;
}

export interface AbsenceRow extends NamedRow {
  days: number;
  excused: number;
  unexcused: number;
  reasons: string;
}

export interface LateRow extends NamedRow {
  lates: number;
  days: number;
  reasons: string;
}

export interface BehaviorRow extends NamedRow {
  entries: number;
  behaviors: string;
}

export interface DeductionRow extends NamedRow {
  points: number;
  reasons: string;
}

export interface DisciplineRow extends NamedRow {
  level: ConductEscalationLevel | null;
  levelLabel: string;
  handledAt: string;
  reason: string;
}

export interface TestBelowRow extends NamedRow {
  /** ກວດກາ per subject where it came in under the line; `null` everywhere else. */
  scores: (number | null)[];
}

export interface GuardianContactRow extends NamedRow {
  date: string;
  content: string;
}

export interface MonthlyReportBody {
  overview: { students: number; female: number };
  absence: {
    totalDays: number;
    excusedDays: number;
    unexcusedDays: number;
    lateDays: number;
    notable: AbsenceRow[];
    lates: LateRow[];
  };
  behavior: BehaviorRow[];
  deductions: DeductionRow[];
  discipline: DisciplineRow[];
  tests: {
    subjects: (TestSubject & { target: number })[];
    below: TestBelowRow[];
    /** Students with at least one ກວດກາ this month — the "/……" of "……/……". */
    tested: number;
  };
  guardianContacts: GuardianContactRow[];
}

// ── The build ───────────────────────────────────────────────────────────────

const byRoll = (roster: ReportStudent[]) => {
  const order = new Map(roster.map((student, index) => [student.studentId, index]));
  return (a: { studentId: string }, b: { studentId: string }) =>
    (order.get(a.studentId) ?? 9999) - (order.get(b.studentId) ?? 9999);
};

/** Every distinct non-empty string, in first-seen order. */
export function distinctText(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** The line a ກວດກາ mark has to reach, rounded to the half-point the form is marked in. */
export function testTarget(testMax: number): number {
  return Math.round(testMax * TEST_TARGET_RATIO * 2) / 2;
}

export function buildMonthlyReport(facts: MonthlyReportFacts): MonthlyReportBody {
  const named = new Map(facts.roster.map((student) => [student.studentId, student]));
  const nameOf = (studentId: string): NamedRow => {
    const student = named.get(studentId);
    return {
      studentId,
      studentCode: student?.studentCode ?? null,
      studentNameLo: student?.studentNameLo ?? '',
    };
  };
  const onRoll = (row: { studentId: string }) => named.has(row.studentId);
  const sortByRoll = byRoll(facts.roster);

  const notesFor = (studentId: string, statuses: AttendanceNote['status'][]) =>
    distinctText(
      facts.attendanceNotes
        .filter((note) => note.studentId === studentId && statuses.includes(note.status))
        .map((note) => note.reason),
    );

  // ── II.1 ການຂາດຮຽນ ──
  const attendance = facts.attendance.filter(onRoll);
  const notable = attendance
    .map((row) => {
      // Days actually missed; the days made of lates have their own table below.
      const unexcused = row.absentUnexcused - row.lateAsAbsent;
      const days = row.absentExcused + unexcused;
      const written = notesFor(row.studentId, ['absent', 'excused', 'sick']);
      const split = `ມີເຫດຜົນ ${row.absentExcused} ມື້, ບໍ່ມີເຫດຜົນ ${unexcused} ມື້`;
      return {
        ...nameOf(row.studentId),
        days,
        excused: row.absentExcused,
        unexcused,
        reasons: written.length > 0 ? `${written.join('; ')} (${split})` : split,
      };
    })
    .filter((row) => row.days >= NOTABLE_ABSENCE_DAYS)
    .sort((a, b) => b.days - a.days || sortByRoll(a, b));

  const lates = attendance
    .filter((row) => row.lateAsAbsent > 0)
    .map((row) => {
      const written = notesFor(row.studentId, ['late']);
      const count = `ມາຊ້າ ${row.late} ຄັ້ງ`;
      return {
        ...nameOf(row.studentId),
        lates: row.late,
        days: row.lateAsAbsent,
        reasons: written.length > 0 ? `${count}: ${written.join('; ')}` : count,
      };
    })
    .sort((a, b) => b.days - a.days || sortByRoll(a, b));

  const sum = (pick: (row: AttendanceFact) => number) =>
    attendance.reduce((total, row) => total + pick(row), 0);

  // ── II.2 ພຶດຕິກຳ ──
  const behaviorByStudent = new Map<string, BehaviorEntry[]>();
  for (const entry of facts.behavior) {
    if (!named.has(entry.studentId)) continue;
    if (!entry.behavior?.trim() && !entry.action?.trim()) continue;
    const list = behaviorByStudent.get(entry.studentId) ?? [];
    list.push(entry);
    behaviorByStudent.set(entry.studentId, list);
  }
  const behavior = [...behaviorByStudent.entries()]
    .map(([studentId, entries]) => ({
      ...nameOf(studentId),
      entries: entries.length,
      behaviors: distinctText(
        [...entries]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((entry) =>
            entry.action?.trim()
              ? `${entry.behavior?.trim() ?? ''} (${entry.action.trim()})`.trim()
              : entry.behavior,
          ),
      ).join('; '),
    }))
    .sort((a, b) => b.entries - a.entries || sortByRoll(a, b));

  // ── II.3 ຖືກຕັດຄະແນນ ──
  const deductionsByStudent = new Map<string, DeductionEntry[]>();
  for (const entry of facts.deductions) {
    if (!named.has(entry.studentId)) continue;
    const list = deductionsByStudent.get(entry.studentId) ?? [];
    list.push(entry);
    deductionsByStudent.set(entry.studentId, list);
  }
  const ruleLine = (entry: DeductionEntry) =>
    `${entry.ruleCode} ${entry.ruleNameLo}${entry.note?.trim() ? ` — ${entry.note.trim()}` : ''}`;
  const deductions = [...deductionsByStudent.entries()]
    .map(([studentId, entries]) => ({
      ...nameOf(studentId),
      points: entries.reduce((total, entry) => total + entry.points, 0),
      reasons: [...entries]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((entry) => `${ruleLine(entry)} (-${entry.points})`)
        .join('; '),
    }))
    .sort((a, b) => b.points - a.points || sortByRoll(a, b));

  // ── II.4 ປະຕິບັດວິໄນ ──
  // A child is on this list if the month moved them up a rung, or if the
  // homeroom teacher sent them on to the discipline committee this month.
  const discipline: DisciplineRow[] = [];
  for (const standing of facts.conduct) {
    if (!named.has(standing.studentId)) continue;
    if (standing.levelByEnd === 'none' || standing.levelByEnd === standing.levelBefore) continue;
    const entries = deductionsByStudent.get(standing.studentId) ?? [];
    discipline.push({
      ...nameOf(standing.studentId),
      level: standing.levelByEnd,
      levelLabel: ESCALATION_LABEL_LO[standing.levelByEnd],
      handledAt: HANDLED_AT[standing.levelByEnd] ?? '',
      reason: `ຖືກຕັດລວມ ${standing.deductedByEnd} ຄະແນນ (${ESCALATION_LABEL_LO[standing.levelByEnd]})${
        entries.length > 0 ? `: ${distinctText(entries.map(ruleLine)).join('; ')}` : ''
      }`,
    });
  }
  const listed = new Set(discipline.map((row) => row.studentId));
  for (const line of facts.reviews) {
    if (line.action !== 'referred_discipline' || !named.has(line.studentId)) continue;
    if (listed.has(line.studentId)) continue;
    listed.add(line.studentId);
    discipline.push({
      ...nameOf(line.studentId),
      level: null,
      levelLabel: 'ສົ່ງຄະນະລະບຽບວິໄນ',
      handledAt: 'ວິຊາການ',
      reason: line.note?.trim() || 'ສົ່ງຄະນະລະບຽບວິໄນ',
    });
  }
  discipline.sort(sortByRoll);

  // ── II.6.1 ຜົນການຮຽນ ──
  const subjects = facts.subjects.map((subject) => ({
    ...subject,
    target: testTarget(subject.testMax),
  }));
  const testRows = facts.tests.filter(onRoll);
  const below = testRows
    .map((row) => ({
      ...nameOf(row.studentId),
      scores: subjects.map((subject, index) => {
        const score = row.testScores[index] ?? null;
        return score !== null && score < subject.target ? score : null;
      }),
    }))
    .filter((row) => row.scores.some((score) => score !== null))
    .sort(sortByRoll);

  // ── III. ການພົວພັນຜູ້ປົກຄອງ ──
  const guardianContacts = facts.reviews
    .filter((line) => named.has(line.studentId))
    .filter((line) => line.action === 'contacted_guardian' || line.contactChannel !== null)
    .map((line) => ({
      ...nameOf(line.studentId),
      date: line.dueDate,
      content: [
        line.contactChannel ? `ທາງ${CONTACT_CHANNEL_LO[line.contactChannel]}` : null,
        line.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(': '),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || sortByRoll(a, b));

  return {
    overview: {
      students: facts.roster.length,
      female: facts.roster.filter((student) => student.isFemale).length,
    },
    absence: {
      totalDays: sum((row) => row.absentTotal),
      excusedDays: sum((row) => row.absentExcused),
      unexcusedDays: sum((row) => row.absentUnexcused),
      lateDays: sum((row) => row.lateAsAbsent),
      notable,
      lates,
    },
    behavior,
    deductions,
    discipline,
    tests: {
      subjects,
      below,
      tested: testRows.filter((row) => row.testScores.some((score) => score !== null)).length,
    },
    guardianContacts,
  };
}
