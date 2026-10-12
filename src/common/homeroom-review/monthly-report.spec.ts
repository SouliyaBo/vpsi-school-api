import {
  buildMonthlyReport,
  distinctText,
  testTarget,
  type MonthlyReportFacts,
  type ReportStudent,
} from './monthly-report';

const student = (id: string, roll: number, isFemale = false): ReportStudent => ({
  studentId: id,
  studentCode: `000${roll}`,
  studentNameLo: `ນັກຮຽນ ${id}`,
  rollNumber: roll,
  isFemale,
});

const empty = (overrides: Partial<MonthlyReportFacts> = {}): MonthlyReportFacts => ({
  roster: [student('a', 1, true), student('b', 2), student('c', 3, true)],
  attendance: [],
  attendanceNotes: [],
  behavior: [],
  deductions: [],
  conduct: [],
  reviews: [],
  subjects: [],
  tests: [],
  ...overrides,
});

const attendance = (
  studentId: string,
  facts: { late?: number; absent?: number; excused?: number },
) => {
  const late = facts.late ?? 0;
  const lateAsAbsent = Math.floor(late / 3);
  const absentUnexcused = (facts.absent ?? 0) + lateAsAbsent;
  const absentExcused = facts.excused ?? 0;
  return {
    studentId,
    late,
    lateAsAbsent,
    absentUnexcused,
    absentExcused,
    absentTotal: absentUnexcused + absentExcused,
  };
};

describe('buildMonthlyReport', () => {
  it('counts the roll and the girls on it', () => {
    expect(buildMonthlyReport(empty()).overview).toEqual({ students: 3, female: 2 });
  });

  describe('absences', () => {
    it('lists only children who missed three days or more, worst first', () => {
      const report = buildMonthlyReport(
        empty({
          attendance: [
            attendance('a', { absent: 1, excused: 2 }),
            attendance('b', { absent: 2 }),
            attendance('c', { absent: 1, excused: 4 }),
          ],
        }),
      );
      expect(report.absence.notable.map((row) => [row.studentId, row.days])).toEqual([
        ['c', 5],
        ['a', 3],
      ]);
    });

    it('does not count days made of lates towards the three — they have their own table', () => {
      const report = buildMonthlyReport(
        empty({ attendance: [attendance('a', { absent: 2, late: 3 })] }),
      );
      expect(report.absence.notable).toEqual([]);
      expect(report.absence.lates).toMatchObject([{ studentId: 'a', lates: 3, days: 1 }]);
      expect(report.absence.totalDays).toBe(3);
      expect(report.absence.lateDays).toBe(1);
    });

    it('carries the reasons written on the roll, once each, with the split', () => {
      const report = buildMonthlyReport(
        empty({
          attendance: [attendance('a', { absent: 1, excused: 2 })],
          attendanceNotes: [
            { studentId: 'a', status: 'sick', reason: 'ເຈັບໄຂ້' },
            { studentId: 'a', status: 'excused', reason: 'ເຈັບໄຂ້' },
            { studentId: 'a', status: 'absent', reason: null },
            { studentId: 'a', status: 'late', reason: 'ລົດຕິດ' },
          ],
        }),
      );
      expect(report.absence.notable[0].reasons).toBe('ເຈັບໄຂ້ (ມີເຫດຜົນ 2 ມື້, ບໍ່ມີເຫດຜົນ 1 ມື້)');
    });

    it('ignores a child no longer on the roll', () => {
      const report = buildMonthlyReport(empty({ attendance: [attendance('gone', { absent: 9 })] }));
      expect(report.absence.notable).toEqual([]);
      expect(report.absence.totalDays).toBe(0);
    });
  });

  it('groups the register by child, most entries first, skipping blank lines', () => {
    const report = buildMonthlyReport(
      empty({
        behavior: [
          { studentId: 'a', date: '2026-10-02', behavior: 'ລົມກັນ', action: null },
          { studentId: 'b', date: '2026-10-01', behavior: 'ນອນຫຼັບ', action: 'ເຕືອນ' },
          { studentId: 'b', date: '2026-10-05', behavior: 'ນອນຫຼັບ', action: 'ເຕືອນ' },
          { studentId: 'c', date: '2026-10-05', behavior: ' ', action: null },
        ],
      }),
    );
    expect(report.behavior).toMatchObject([
      { studentId: 'b', entries: 2, behaviors: 'ນອນຫຼັບ (ເຕືອນ)' },
      { studentId: 'a', entries: 1, behaviors: 'ລົມກັນ' },
    ]);
  });

  it('totals the points each child lost this month', () => {
    const report = buildMonthlyReport(
      empty({
        deductions: [
          {
            studentId: 'a',
            date: '2026-10-03',
            ruleCode: '2.1',
            ruleNameLo: 'ມາຊ້າ',
            points: 10,
            note: null,
          },
          {
            studentId: 'a',
            date: '2026-10-01',
            ruleCode: '3.4',
            ruleNameLo: 'ສູບຢາ',
            points: 15,
            note: 'ຫຼັງຫ້ອງນ້ຳ',
          },
        ],
      }),
    );
    expect(report.deductions).toEqual([
      expect.objectContaining({
        studentId: 'a',
        points: 25,
        reasons: '3.4 ສູບຢາ — ຫຼັງຫ້ອງນ້ຳ (-15); 2.1 ມາຊ້າ (-10)',
      }),
    ]);
  });

  describe('discipline', () => {
    it('names a child the month moved up a rung, and who handles that rung', () => {
      const report = buildMonthlyReport(
        empty({
          conduct: [
            {
              studentId: 'a',
              deductedBefore: 5,
              deductedByEnd: 20,
              levelBefore: 'none',
              levelByEnd: 'level1',
            },
            {
              studentId: 'b',
              deductedBefore: 30,
              deductedByEnd: 35,
              levelBefore: 'level2',
              levelByEnd: 'level2',
            },
            {
              studentId: 'c',
              deductedBefore: 60,
              deductedByEnd: 70,
              levelBefore: 'level2',
              levelByEnd: 'level3',
            },
          ],
        }),
      );
      expect(report.discipline.map((row) => [row.studentId, row.handledAt])).toEqual([
        ['a', 'ຄູປະຈຳຫ້ອງ'],
        ['c', 'ອຳນວຍການ'],
      ]);
    });

    it('adds a child the teacher referred to the committee, once', () => {
      const report = buildMonthlyReport(
        empty({
          reviews: [
            {
              studentId: 'b',
              dueDate: '2026-10-07',
              action: 'referred_discipline',
              contactChannel: null,
              note: 'ຕີກັນ',
            },
            {
              studentId: 'b',
              dueDate: '2026-10-09',
              action: 'referred_discipline',
              contactChannel: null,
              note: null,
            },
          ],
        }),
      );
      expect(report.discipline).toMatchObject([
        { studentId: 'b', handledAt: 'ວິຊາການ', reason: 'ຕີກັນ' },
      ]);
    });
  });

  it('keeps only the ກວດກາ marks under the line, and counts who sat a test', () => {
    const report = buildMonthlyReport(
      empty({
        subjects: [
          { id: 'math', nameLo: 'ຄະນິດສາດ', testMax: 6 },
          { id: 'lao', nameLo: 'ພາສາລາວ', testMax: 6 },
        ],
        tests: [
          { studentId: 'a', testScores: [2.5, 4] },
          { studentId: 'b', testScores: [3, 5] },
          { studentId: 'c', testScores: [null, null] },
        ],
      }),
    );
    expect(report.tests.below).toMatchObject([{ studentId: 'a', scores: [2.5, null] }]);
    expect(report.tests.tested).toBe(2);
    expect(report.tests.subjects[0].target).toBe(3);
  });

  it('lists the guardians reached in the month’s reviews, by date', () => {
    const report = buildMonthlyReport(
      empty({
        reviews: [
          {
            studentId: 'a',
            dueDate: '2026-10-09',
            action: 'contacted_guardian',
            contactChannel: 'phone',
            note: 'ແຈ້ງເລື່ອງຂາດຮຽນ',
          },
          {
            studentId: 'b',
            dueDate: '2026-10-07',
            action: 'contacted_guardian',
            contactChannel: 'letter',
            note: null,
          },
          {
            studentId: 'c',
            dueDate: '2026-10-07',
            action: 'warned_student',
            contactChannel: null,
            note: 'x',
          },
        ],
      }),
    );
    expect(report.guardianContacts).toMatchObject([
      { studentId: 'b', date: '2026-10-07', content: 'ທາງໜັງສືເຊີນ' },
      { studentId: 'a', date: '2026-10-09', content: 'ທາງໂທລະສັບ: ແຈ້ງເລື່ອງຂາດຮຽນ' },
    ]);
  });
});

describe('testTarget', () => {
  it('is half the column, to the half point', () => {
    expect(testTarget(6)).toBe(3);
    expect(testTarget(5)).toBe(2.5);
    expect(testTarget(7)).toBe(3.5);
  });
});

describe('distinctText', () => {
  it('drops blanks and repeats, keeping first-seen order', () => {
    expect(distinctText([' a ', null, 'b', 'a', '', undefined])).toEqual(['a', 'b']);
  });
});
