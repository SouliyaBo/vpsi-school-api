import {
  ConductEscalationLevel,
  ConductNotifyParty,
  CONDUCT_ESCALATION_LEVELS,
} from 'src/common/constants/enums';

/**
 * The ໝາຍເຫດ at the foot of the school's rule sheet, as a table.
 *
 * The sheet does not stop at "what each offence costs": it says who has to be
 * told once a child has lost enough, and the answer widens at each rung — the
 * homeroom teacher alone, then the discipline committee and the guardians, then
 * student affairs, then the director, and finally the child's place at the
 * school. That ladder is the point of the whole exercise, so it is written out
 * here rather than left for each screen to re-derive from a pile of thresholds.
 *
 * Kept in code beside `CONDUCT_BANDS` rather than in `settings`: it is school
 * policy issued once a year over the director's signature, not a knob, and a
 * change to it should be reviewed the way a change to the grading scale is.
 */

export const CONDUCT_BASE_SCORE = 100;

export interface EscalationRung {
  level: ConductEscalationLevel;
  /** Total points lost this term at which the rung is reached. */
  minDeducted: number;
  /** Who the sheet says must be told. Empty below the first rung. */
  notify: readonly ConductNotifyParty[];
}

/**
 * Highest rung first, so the first match wins.
 *
 * The sheet writes its bands as ranges — 10–15, 20, 30–50, 70, 100 — but they
 * are open-ended in practice: a child who has lost 60 is past the 30–50 rung and
 * not yet at 70, and the sheet plainly means them to be handled at the rung they
 * have passed. Stored as lower bounds for that reason.
 */
export const ESCALATION_LADDER: readonly EscalationRung[] = [
  {
    // ຖືກຕັດ 100 ຄະແນນ — the child's place at the school is reconsidered.
    level: 'review',
    minDeducted: 100,
    notify: ['director', 'studentAffairs', 'disciplineCommittee', 'guardian', 'student'],
  },
  {
    // ຂັ້ນ 3, ຂັ້ນໂຮງຮຽນ.
    level: 'level3',
    minDeducted: 70,
    notify: ['director', 'studentAffairs', 'guardian', 'student'],
  },
  {
    // ຂັ້ນ 2.
    level: 'level2',
    minDeducted: 30,
    notify: ['homeroomTeacher', 'studentAffairs', 'disciplineCommittee', 'guardian', 'student'],
  },
  {
    // ຂັ້ນ 1.
    level: 'level1',
    minDeducted: 20,
    notify: ['homeroomTeacher', 'disciplineCommittee', 'guardian', 'student'],
  },
  {
    // ຂັ້ນຫ້ອງ — handled inside the classroom.
    level: 'classroom',
    minDeducted: 10,
    notify: ['homeroomTeacher', 'student'],
  },
  { level: 'none', minDeducted: 0, notify: [] },
];

/** The rung a term's running total has reached. */
export function escalationFor(deducted: number): EscalationRung {
  return (
    ESCALATION_LADDER.find((rung) => deducted >= rung.minDeducted) ?? ESCALATION_LADDER.at(-1)!
  );
}

/**
 * What is left of the 100, floored at zero.
 *
 * A term can be over-deducted — the rules are applied per occurrence and nobody
 * stops at exactly 100 — and the ledger keeps every row, so the raw total is
 * still there to read. What the report card prints, though, is a score, and a
 * negative one would be a number the grading scale has no band for.
 */
export function remainingFrom(deducted: number): number {
  return Math.max(0, CONDUCT_BASE_SCORE - deducted);
}

/** Sort order for a class list read worst-first, which is how it is read. */
export function byMostDeducted<T extends { deducted: number }>(a: T, b: T): number {
  return b.deducted - a.deducted;
}

/** Rungs in ascending severity, for a screen that renders the ladder itself. */
export function ladderAscending(): readonly EscalationRung[] {
  return [...ESCALATION_LADDER].sort(
    (a, b) =>
      CONDUCT_ESCALATION_LEVELS.indexOf(a.level) - CONDUCT_ESCALATION_LEVELS.indexOf(b.level),
  );
}
