import { absenceDays, normalizeLatesPerAbsence, type StatusCounts } from './absence-days';

const counts = (partial: Partial<StatusCounts>): StatusCounts => ({
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  sick: 0,
  ...partial,
});

describe('absenceDays', () => {
  it('turns every three lates into one unexcused absence, and keeps the rest as lates', () => {
    const days = absenceDays(counts({ present: 10, late: 7 }));
    expect(days.lateAsAbsent).toBe(2);
    expect(days.lateRemainder).toBe(1);
    expect(days.absentUnexcused).toBe(2);
  });

  it('adds the lates-turned-absences to the outright ones', () => {
    const days = absenceDays(counts({ absent: 1, late: 3 }));
    expect(days.absentUnexcused).toBe(2);
    expect(days.lateRemainder).toBe(0);
  });

  it('does not convert fewer lates than the rule takes', () => {
    const days = absenceDays(counts({ present: 5, late: 2 }));
    expect(days.lateAsAbsent).toBe(0);
    expect(days.lateRemainder).toBe(2);
    expect(days.absentUnexcused).toBe(0);
  });

  it('counts excused and sick together as absences with a reason', () => {
    const days = absenceDays(counts({ excused: 2, sick: 1, absent: 1 }));
    expect(days.absentExcused).toBe(3);
    expect(days.absentTotal).toBe(4);
  });

  it('drops the rate for a late that has become an absence', () => {
    // 10 recorded: 7 present, 3 late. All three are attended lessons on the
    // roll, but together they are one day absent, so 9 of 10 count.
    expect(absenceDays(counts({ present: 7, late: 3 })).attendanceRate).toBe(90);
    // Two lates are still two attended lessons.
    expect(absenceDays(counts({ present: 8, late: 2 })).attendanceRate).toBe(100);
  });

  it('keeps the rate as it was when no late converts', () => {
    // One late, one absent: the late is attended, so half the lessons count.
    expect(absenceDays(counts({ absent: 1, late: 1 })).attendanceRate).toBe(50);
    expect(absenceDays(counts({})).attendanceRate).toBe(0);
  });

  it('applies the office’s own rule when one is set', () => {
    const days = absenceDays(counts({ late: 4 }), 2);
    expect(days.lateAsAbsent).toBe(2);
    expect(days.latesPerAbsence).toBe(2);
  });

  it('falls back to three for a rule that would not divide', () => {
    expect(normalizeLatesPerAbsence(0)).toBe(3);
    expect(normalizeLatesPerAbsence(-1)).toBe(3);
    expect(normalizeLatesPerAbsence(2.5)).toBe(3);
    expect(normalizeLatesPerAbsence('3')).toBe(3);
    expect(normalizeLatesPerAbsence(null)).toBe(3);
    expect(normalizeLatesPerAbsence(4)).toBe(4);
  });
});
