import {
  annualScore,
  COLUMN_MAX,
  isPassing,
  isWithinMax,
  meanOf,
  monthScore,
  monthsForSemester,
  monthTotal,
  semesterScore,
  threeMonthAverage,
  type MonthCells,
} from './monthly-grading';

/** A month as the form is filled in, with anything unstated left blank. */
const cells = (overrides: Partial<MonthCells> = {}): MonthCells => ({
  attendance: null,
  notebook: null,
  activity: null,
  test: null,
  ...overrides,
});

describe('monthTotal', () => {
  it('adds the four columns to a mark out of 10', () => {
    expect(monthTotal(cells({ attendance: 1, notebook: 1, activity: 2, test: 6 }))).toBe(10);
  });

  it('reproduces the sheet — ເກວະລິນ, ກັນຍາ', () => {
    expect(monthTotal(cells({ attendance: 1, notebook: 1, activity: 2, test: 3.9 }))).toBe(7.9);
  });

  it('counts a blank cell as zero, as the paper does', () => {
    // ເມສາ on the real sheet: no ປື້ມ mark, and the month still totals 9.
    expect(monthTotal(cells({ attendance: 1, activity: 2, test: 6 }))).toBe(9);
  });

  it('has no total at all when nothing was written', () => {
    // "Not entered" has to stay distinguishable from "scored zero" — the whole
    // coverage report depends on the difference.
    expect(monthTotal(cells())).toBeNull();
  });

  it('keeps a zero the teacher actually entered', () => {
    expect(monthTotal(cells({ attendance: 0, notebook: 0, activity: 0, test: 0 }))).toBe(0);
  });
});

describe('isWithinMax', () => {
  it('holds each column to its own maximum', () => {
    expect(COLUMN_MAX).toEqual({ attendance: 1, notebook: 1, activity: 2, test: 6 });
    expect(isWithinMax('activity', 2)).toBe(true);
    expect(isWithinMax('activity', 2.5)).toBe(false);
    expect(isWithinMax('test', 6)).toBe(true);
    expect(isWithinMax('test', 6.1)).toBe(false);
  });

  it('accepts the fractions the sheet is full of, and refuses negatives', () => {
    expect(isWithinMax('attendance', 0.8)).toBe(true);
    expect(isWithinMax('notebook', 0.5)).toBe(true);
    expect(isWithinMax('test', -1)).toBe(false);
  });
});

describe('threeMonthAverage', () => {
  it('does not round the monthly totals first — ສຸກນິລັນ, ພາກ II', () => {
    // The school's own ມ.4 sheet: 8.67, 7.1, 5.7 → 7.16. Rounding the months to
    // 9, 7, 6 first would give 7.33 and hand out marks nobody earned.
    expect(threeMonthAverage([8.67, 7.1, 5.7], 3).value).toBe(7.16);
  });

  it('reproduces ແສງດາລາ, ພາກ II', () => {
    expect(threeMonthAverage([9.25, 9.3, 7.6], 3).value).toBe(8.72);
  });

  it('averages over the months recorded so far, and says it is not final', () => {
    // Two months in, the class reads as those two months rather than as a third
    // of itself.
    expect(threeMonthAverage([8, 9, null], 3)).toEqual({ value: 8.5, isComplete: false });
  });

  it('is complete once every month is in', () => {
    expect(threeMonthAverage([8, 9, 7], 3)).toEqual({ value: 8, isComplete: true });
  });

  it('counts the zeros of a student who has left', () => {
    // ສັນຍາຮັກ: the school records the remaining months as zero rather than
    // leaving them out, and the average drops accordingly.
    expect(threeMonthAverage([0, 0, 0], 3)).toEqual({ value: 0, isComplete: true });
  });

  it('has nothing to say about a month nobody has marked', () => {
    expect(threeMonthAverage([null, null, null], 3)).toEqual({ value: null, isComplete: false });
  });
});

describe('monthScore — subjects taught in strands', () => {
  it('averages ຟີຊິກ, ເຄມີ and ຊີວະ — ຈຸທາມາດ, ກັນຍາ', () => {
    expect(monthScore([8.5, 7.4, 8.4], 3).value).toBe(8.1);
  });

  it('leaves a subject with no strands exactly as it was', () => {
    expect(monthScore([7.9], 1)).toEqual({ value: 7.9, isComplete: true });
  });

  it('flags a month where one strand is still missing', () => {
    expect(monthScore([8.5, null, 8.4], 3)).toEqual({ value: 8.45, isComplete: false });
  });
});

describe('semesterScore', () => {
  it('halves the three-month average with the exam — ເກວະລິນ, ພາກ I', () => {
    expect(semesterScore(8, 8.4).value).toBe(8.2);
  });

  it('keeps the full precision of the three-month figure — ຈຸທາມາດ, ພາກ II', () => {
    // The sheet displays 8.67, but the term mark is computed from 8.6667 and
    // comes out 8.38, not 8.39.
    expect(semesterScore(round(26 / 3), 8.1).value).toBe(8.38);
  });

  it('adds ເພີ່ມ on top', () => {
    expect(semesterScore(8, 8.4, 0.5).value).toBe(8.7);
  });

  it('caps a bonus at full marks', () => {
    // A bonus can lift a mark to 10; it cannot take it past 10.
    expect(semesterScore(9.6, 9.8, 2).value).toBe(10);
  });

  it('withholds the term mark until the exam is sat', () => {
    expect(semesterScore(8, null)).toEqual({ value: null, isComplete: false });
    expect(semesterScore(null, 8.4)).toEqual({ value: null, isComplete: false });
  });

  it('treats an exam scored zero as a mark, not as a gap', () => {
    // ສັນຍາຮັກ sat nothing and was given 0: ພາກຮຽນ I = 3.84, not blank.
    expect(semesterScore(7.67, 0).value).toBe(3.84);
  });
});

describe('annualScore', () => {
  it('averages the two terms — ຈຸທາມາດ', () => {
    expect(annualScore(8.62, 8.38).value).toBe(8.5);
  });

  it('carries a term of zeros into the year, as the sheet does', () => {
    // ສັນຍາຮັກ: 3.84 and nothing after leaving → 1.92 for the year.
    expect(annualScore(3.84, 0).value).toBe(1.92);
  });

  it('waits for both terms', () => {
    expect(annualScore(8.62, null)).toEqual({ value: null, isComplete: false });
  });
});

describe('isPassing', () => {
  it('passes at half marks and fails below', () => {
    expect(isPassing(5)).toBe(true);
    expect(isPassing(4.99)).toBe(false);
    // 4.89 is the mark the school highlights in red on ສີວິໄຊ's row.
    expect(isPassing(4.89)).toBe(false);
  });

  it('says nothing about a mark that does not exist yet', () => {
    expect(isPassing(null)).toBeNull();
  });
});

describe('monthsForSemester', () => {
  it('collects ກັນຍາ–ພະຈິກ and ກຸມພາ–ເມສາ by default', () => {
    expect(monthsForSemester(1)).toEqual([9, 10, 11]);
    expect(monthsForSemester(2)).toEqual([2, 3, 4]);
  });

  it('honours an override from settings', () => {
    expect(monthsForSemester(1, { '1': [10, 11, 12] })).toEqual([10, 11, 12]);
  });

  it('ignores a malformed override rather than collecting nothing', () => {
    expect(monthsForSemester(1, { '1': [] })).toEqual([9, 10, 11]);
    expect(monthsForSemester(1, { '1': [0, 13] as number[] })).toEqual([9, 10, 11]);
  });
});

describe('meanOf', () => {
  it('rounds to two decimals', () => {
    expect(meanOf([8.5, 7.4, 8.4], 3).value).toBe(8.1);
    expect(meanOf([1, 2], 2).value).toBe(1.5);
  });
});

/** Rounds like the sheet displays, for the fixtures above. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
