import { round2 } from '../term-results/grading';

/**
 * The school's real mark sheet: ຄະແນນປະຈຳເດືອນ, out of 10.
 *
 * This is not the weighted-component model in `score-components` — it is the
 * paper form every teacher keeps, and it is a hierarchy rather than a flat list
 * of weights:
 *
 *   4 columns → ລວມ (/10) → [ສະເລ່ຍ across strands] → 3 ເດືອນ → ພາກຮຽນ → ໝົດປີ
 *
 * Kept free of Mongoose so every rule below can be tested against the
 * spreadsheet the school actually uses; the service does the reads and hands the
 * numbers in.
 *
 * Two rules were settled against the school's own files, which disagreed with
 * each other, so they are stated here once and applied everywhere:
 *
 *  1. **Nothing is rounded on the way in.** A month worth 8.45 carries 8.45 into
 *     the three-month average; rounding is a display decision only. The other
 *     variant (round `ລວມ` to a whole number first) cost ສີວິໄຊ the pass mark —
 *     5.67 instead of 5.98 — which is the difference between ຕົກ and ຜ່ານ.
 *  2. **`ເພີ່ມ` is added to ພາກຮຽນ and the result is capped at the subject's full
 *     mark** — 10, or 9 for the subjects whose ກວດກາ is out of 5.
 *
 * Most subjects are out of 10. Since 20 Oct 2026 ພາສາລາວ, ປະຫວັດສາດ,
 * ສຶກສາພົນລະເມືອງ and ພູມສາດ are out of **9** (ກວດກາ 5), and so is their
 * ສອບເສັງ: the office's ruling is that these subjects never reach 10. Their
 * marks are kept as they are — a 9/9 reads 9, not 10 — but their ເກຣດ and
 * ຜ່ານ/ຕົກ are judged on the share of 9 (pass at 4.5, A from 7.65). See
 * `fullMarkOf`, `passingMarkFor` and `shareOf`.
 */

/** The four columns of the monthly form, with the marks each is out of. */
export const MONTHLY_COLUMNS = ['attendance', 'notebook', 'activity', 'test'] as const;
export type MonthlyColumn = (typeof MONTHLY_COLUMNS)[number];

/** ຂື້ນຫ້ອງ 1 · ປື້ມ 1 · ກິດຈະກຳ 2 · ກວດກາ 6 — what a subject is marked on unless it says otherwise. */
export const COLUMN_MAX: Readonly<Record<MonthlyColumn, number>> = {
  attendance: 1,
  notebook: 1,
  activity: 2,
  test: 6,
};

/**
 * One subject's own column maxima, where the school marks it differently.
 *
 * Since 20 Oct 2026 (office's ruling):
 *
 *   ພາສາລາວ, every grade                                 1 / 1 / 2 / 5  → 9
 *   ປະຫວັດສາດ · ສຶກສາພົນລະເມືອງ · ພູມສາດ, ມ.1–ມ.3, ມ.5, ມ.6  1 / 0 / 3 / 5  → 9  (no ປື້ມ)
 *   the same three at ມ.4, ມ.7                           1 / 1 / 2 / 5  → 9
 *   everything else                                     1 / 1 / 2 / 6  → 10
 *
 * ພູມສາດ, ສຶກສາພົນລະເມືອງ and ປະຫວັດສາດ were split out of ສັງຄົມ at ມ.1–ມ.3 on the
 * same day, and ຟີຊິກສາດ and ເຄມີສາດ out of ທຳມະຊາດ (on the standard 1 / 1 / 2 / 6);
 * until then both ສາຍວິຊາ were marked as one subject there.
 *
 * Held per subject rather than as a rule about names and grades, because the
 * subject rows already exist one per grade — which is the only reason the same
 * subject can be marked two ways at two grades — and the office can then change
 * which columns it keeps without a release.
 *
 * A column at 0 is **not marked**, which is not the same as marked and scored
 * zero: the form drops it rather than showing a cell nobody may fill, and a
 * value sent for it is refused.
 */
export type ColumnMaxOverride = Partial<Record<MonthlyColumn, number>>;

/**
 * Whether an override may be stored against a subject.
 *
 * The four columns may total anything above 0 up to 10. Until 20 Oct 2026 they
 * had to come to exactly 10; the office then put four subjects on 9, which is
 * now carried through as the subject's full mark (`fullMarkOf`) — its exam, the
 * cap on its term mark, and the share its grade and pass are judged on. Refused
 * whole rather than partly applied, for the reason the band cuts are.
 */
export function isColumnMaxUsable(override: ColumnMaxOverride | null | undefined): boolean {
  if (!override) return false;

  const values: number[] = [];
  for (const column of MONTHLY_COLUMNS) {
    const value = override[column];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    values.push(value);
  }
  const total = round2(values.reduce((sum, value) => sum + value, 0));
  return total > 0 && total <= MARK_MAX;
}

/**
 * What a subject is out of — a month, its ສອບເສັງ, its term and its year alike:
 * the sum of its columns, so 10 for most subjects and 9 where ກວດກາ is out of 5.
 */
export function fullMarkOf(max: Readonly<Record<MonthlyColumn, number>>): number {
  return round2(MONTHLY_COLUMNS.reduce((sum, column) => sum + max[column], 0));
}

/**
 * ຜ່ານ for a subject out of `fullMark`: the same half of it — 5 of 10, 4.5 of 9.
 *
 * The office's ruling for the 9-point subjects (20 Oct 2026) is that pass and
 * grade are a share of 9, not a mark out of 10 they could never fully reach.
 */
export function passingMarkFor(fullMark: number = MARK_MAX): number {
  return round2((fullMark * PASSING_MARK) / MARK_MAX);
}

/** A mark as a percentage of what its subject is out of — what a ເກຣດ is banded on. */
export function shareOf(mark: number, fullMark: number = MARK_MAX): number {
  return fullMark <= 0 ? 0 : round2((mark / fullMark) * 100);
}

/** The maxima to mark a subject on: its own where it has usable ones, else the school's. */
export function columnMaxFor(
  override?: ColumnMaxOverride | null,
): Readonly<Record<MonthlyColumn, number>> {
  if (!isColumnMaxUsable(override)) return COLUMN_MAX;
  return Object.fromEntries(
    MONTHLY_COLUMNS.map((column) => [column, override?.[column] ?? 0]),
  ) as Record<MonthlyColumn, number>;
}

/** The columns a subject is actually marked on — the ones worth more than nothing. */
export function markedColumns(max: Readonly<Record<MonthlyColumn, number>>): MonthlyColumn[] {
  return MONTHLY_COLUMNS.filter((column) => max[column] > 0);
}

/** Every part of the sheet is out of 10 — a month, an exam, a term, a year. */
export const MARK_MAX = 10;

/** ຜ່ານ at half marks, the same 50% the rest of the system passes at. */
export const PASSING_MARK = 5;

/**
 * ຈັດປະເພດ — the three bands the school writes beside a month's ສະເລ່ຍ.
 *
 * Not the same thing as ເກຣດ, and not derivable from it: the letter scale runs
 * A–F over percentages for the report card, while this is the three-way split
 * the school reads a monthly sheet out by. Two marks can share a letter and fall
 * either side of ເກັ່ງ.
 */
export const MONTHLY_BANDS = ['strong', 'middling', 'weak'] as const;
export type MonthlyBand = (typeof MONTHLY_BANDS)[number];

/** Where the school cuts the bands, on the 10-point mark the sheet is written in. */
export interface MonthlyBandCuts {
  /** ເກັ່ງ from this mark up. */
  strongFrom: number;
  /** ອ່ອນ below this mark. */
  weakBelow: number;
}

export const DEFAULT_MONTHLY_BANDS: MonthlyBandCuts = {
  strongFrom: 7,
  weakBelow: PASSING_MARK,
};

/**
 * The cuts, honouring an override from settings.
 *
 * A pair that crosses — ອ່ອນ cut above the ເກັ່ງ one — would leave ກາງ with
 * nothing in it and band the same mark two ways, so it is refused whole rather
 * than half-applied: a sheet banded on half a rule is worse than one banded on
 * the default.
 */
export function monthlyBandsFrom(configured?: Partial<MonthlyBandCuts> | null): MonthlyBandCuts {
  const strongFrom = markOnScale(configured?.strongFrom);
  const weakBelow = markOnScale(configured?.weakBelow);
  if (strongFrom === null || weakBelow === null || weakBelow > strongFrom) {
    return DEFAULT_MONTHLY_BANDS;
  }
  return { strongFrom, weakBelow };
}

/** Which band a month's ສະເລ່ຍ falls in. */
export function classifyMonth(average: number, cuts: MonthlyBandCuts): MonthlyBand {
  if (average < cuts.weakBelow) return 'weak';
  return average >= cuts.strongFrom ? 'strong' : 'middling';
}

function markOnScale(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MARK_MAX
    ? value
    : null;
}

/** Which calendar months each semester collects, when nothing overrides it. */
export const DEFAULT_SEMESTER_MONTHS: Readonly<Record<number, number[]>> = {
  1: [9, 10, 11],
  2: [2, 3, 4],
};

/**
 * Re-exported so a stored monthly sheet keeps naming its own columns.
 *
 * The names live in `common/utils/lao-date` because certificates and letters
 * need the same twelve strings, and two copies would eventually disagree.
 */
export { LAO_MONTHS } from 'src/common/utils/lao-date';

/** One month's four cells. `null` is "not written yet", which is not zero. */
export type MonthCells = Readonly<Record<MonthlyColumn, number | null>>;

export const EMPTY_CELLS: MonthCells = {
  attendance: null,
  notebook: null,
  activity: null,
  test: null,
};

/**
 * A part of the sheet that may not be filled in yet.
 *
 * `value` is `null` only when nothing at all has been recorded; a partly filled
 * month still has a value, with `isComplete` saying it is not the final word.
 */
export interface Derived {
  value: number | null;
  isComplete: boolean;
}

/**
 * `ລວມ` — the month's total, out of the subject's full mark (10, or 9).
 *
 * A blank cell counts as zero, matching the paper: a student with no ປື້ມ mark
 * scored nothing for their notebook that month. A month with all four cells
 * blank has no total at all, which is how "not entered" stays distinguishable
 * from "scored zero".
 */
export function monthTotal(cells: MonthCells): number | null {
  const written = MONTHLY_COLUMNS.filter((column) => cells[column] !== null);
  if (written.length === 0) return null;
  return round2(written.reduce((sum, column) => sum + (cells[column] ?? 0), 0));
}

/**
 * Whether a cell is within the mark its column is out of.
 *
 * `max` is the subject's own where it keeps one, so a ປື້ມ mark on a subject
 * that has no notebook column fails here rather than being stored out of 0.
 */
export function isWithinMax(
  column: MonthlyColumn,
  value: number,
  max: Readonly<Record<MonthlyColumn, number>> = COLUMN_MAX,
): boolean {
  return value >= 0 && value <= max[column];
}

/**
 * The mean of the parts that exist, or `null` when none do.
 *
 * Used for every level of the sheet that averages: the strands within a month,
 * and the months within a semester. Dividing by what was recorded rather than by
 * what is expected keeps a mid-term figure honest — a class two months in reads
 * as the average of those two months, flagged incomplete, rather than as a third
 * of itself.
 *
 * A student who has left is not this case: the school records their remaining
 * months as zero, so those months count and drag the average down as they do on
 * paper.
 */
export function meanOf(parts: (number | null)[], expected: number): Derived {
  const written = parts.filter((part): part is number => part !== null);
  if (written.length === 0) return { value: null, isComplete: false };

  return {
    value: round2(written.reduce((sum, part) => sum + part, 0) / written.length),
    isComplete: written.length >= expected,
  };
}

/**
 * `ສະເລ່ຍ` — one month of a subject taught in strands.
 *
 * ວິທະຍາສາດທຳມະຊາດ is scored as ຟີຊິກ, ເຄມີ and ຊີວະ, each out of 10, and the
 * month is their plain mean. A subject with no strands has exactly one total,
 * and this returns it unchanged.
 */
export function monthScore(strandTotals: (number | null)[], expectedStrands: number): Derived {
  return meanOf(strandTotals, Math.max(expectedStrands, 1));
}

/**
 * ສະເລ່ຍ across a month's **subjects** — the class summary's average.
 *
 * The school's rule in its own words: add the subject marks up and divide by the
 * number of subjects the grade sits — 7 at ມ.1–ມ.3, 8 at ມ.4 and ມ.7, 7 at ມ.5 and
 * ມ.6. Not `meanOf`, which divides by what has been written: a student marked in
 * three of eight subjects has three eighths of a month, and showing the mean of
 * the three would read as a finished month five subjects short.
 *
 * The divisor never falls below what was handed in, so a register briefly out of
 * step with the sheet cannot produce an average above 10.
 */
export function acrossSubjects(scores: (number | null)[], expectedSubjects: number): Derived {
  const written = scores.filter((score): score is number => score !== null);
  if (written.length === 0) return { value: null, isComplete: false };

  const divisor = Math.max(expectedSubjects, written.length);
  return {
    value: round2(written.reduce((sum, score) => sum + score, 0) / divisor),
    isComplete: written.length >= expectedSubjects,
  };
}

/** `3 ເດືອນ` — the mean of the semester's monthly scores. */
export function threeMonthAverage(monthScores: (number | null)[], expectedMonths: number): Derived {
  return meanOf(monthScores, expectedMonths);
}

/**
 * `ພາກຮຽນ` — the term mark.
 *
 * Monthly work and the semester exam count half each, then `ເພີ່ມ` is added on
 * top and the whole thing is capped at the subject's full mark (10, or 9): a
 * bonus can lift a mark to full but not past it.
 *
 * Both halves are required. Showing a term mark before the exam is sat would
 * publish a number that is going to move, so it stays `null` and the sheet shows
 * the three-month average on its own until then.
 */
export function semesterScore(
  threeMonth: number | null,
  exam: number | null,
  bonus: number | null = null,
  fullMark: number = MARK_MAX,
): Derived {
  if (threeMonth === null || exam === null) return { value: null, isComplete: false };
  return {
    value: round2(Math.min(fullMark, (threeMonth + exam) / 2 + (bonus ?? 0))),
    isComplete: true,
  };
}

/** `ໝົດປີ` — the mean of the two term marks. Both are needed. */
export function annualScore(first: number | null, second: number | null): Derived {
  if (first === null || second === null) return { value: null, isComplete: false };
  return { value: round2((first + second) / 2), isComplete: true };
}

/**
 * ຜ່ານ / ຕົກ. An unmarked figure is neither, so it is not a failure.
 *
 * `fullMark` is the subject's, for a subject mark; an average across subjects is
 * judged on 10, the school's own rule for the month and the term.
 */
export function isPassing(value: number | null, fullMark: number = MARK_MAX): boolean | null {
  return value === null ? null : value >= passingMarkFor(fullMark);
}

/** The months a semester collects, honouring an override from settings. */
export function monthsForSemester(
  semesterNumber: number,
  configured?: Record<string, number[]> | null,
): number[] {
  const override = configured?.[String(semesterNumber)];
  if (Array.isArray(override) && override.length > 0 && override.every(isCalendarMonth)) {
    return [...override];
  }
  return [...(DEFAULT_SEMESTER_MONTHS[semesterNumber] ?? [])];
}

function isCalendarMonth(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}
