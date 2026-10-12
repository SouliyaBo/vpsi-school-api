import {
  DEFAULT_REVIEW_THRESHOLDS,
  flagStudents,
  normalizeThresholds,
  type AttendanceFacts,
  type BehaviorFacts,
  type RosterEntry,
} from './review-anomalies';

const student = (id: string, roll: number): RosterEntry => ({
  studentId: id,
  studentCode: `08${roll.toString().padStart(2, '0')}`,
  studentNameLo: `ນັກຮຽນ ${id}`,
  studentNickname: id,
  rollNumber: roll,
});

const attendance = (id: string, over: Partial<AttendanceFacts> = {}): AttendanceFacts => ({
  studentId: id,
  absentUnexcused: 0,
  late: 0,
  absentExcused: 0,
  attendanceRate: 100,
  totalRecorded: 20,
  ...over,
});

const behavior = (id: string, over: Partial<BehaviorFacts> = {}): BehaviorFacts => ({
  studentId: id,
  entries: 0,
  withAction: 0,
  lastDate: null,
  ...over,
});

const empty = { attendance: [], behavior: [] };
const emptyTerm = { attendance: [], behavior: [], conduct: [] };

describe('flagStudents', () => {
  it('leaves a clean class empty — a child with nothing recorded is not a row', () => {
    expect(
      flagStudents({
        roster: [student('a', 1), student('b', 2)],
        window: empty,
        term: emptyTerm,
      }),
    ).toEqual([]);
  });

  it('flags one unexplained day since the last review', () => {
    const [row] = flagStudents({
      roster: [student('a', 1)],
      window: { attendance: [attendance('a', { absentUnexcused: 1 })], behavior: [] },
      term: emptyTerm,
    });

    expect(row.studentId).toBe('a');
    expect(row.reasons).toEqual([{ kind: 'absence', scope: 'window', value: 1, threshold: 1 }]);
    // Nothing the term has to say about them yet, so this is a phone call and
    // not a meeting.
    expect(row.severity).toBe('watch');
  });

  it('does not flag a sick note', () => {
    expect(
      flagStudents({
        roster: [student('a', 1)],
        window: { attendance: [attendance('a', { absentExcused: 3 })], behavior: [] },
        term: { attendance: [attendance('a', { absentExcused: 3 })], behavior: [], conduct: [] },
      }),
    ).toEqual([]);
  });

  it('flags the slow slide: nothing this week, fourteen days for the term', () => {
    const [row] = flagStudents({
      roster: [student('a', 1)],
      window: empty,
      term: {
        attendance: [attendance('a', { absentUnexcused: 14, attendanceRate: 62 })],
        behavior: [],
        conduct: [],
      },
    });

    expect(row.reasons.map((reason) => `${reason.kind}:${reason.scope}`)).toEqual([
      'absence:term',
      'attendance_rate:term',
    ]);
    expect(row.severity).toBe('act');
  });

  it('holds back an attendance rate the roll has barely been taken for', () => {
    // 1 of 2 lessons missed reads as 50%, which would flag half a class in the
    // first week of every term.
    expect(
      flagStudents({
        roster: [student('a', 1)],
        window: empty,
        term: {
          attendance: [attendance('a', { attendanceRate: 50, totalRecorded: 2 })],
          behavior: [],
          conduct: [],
        },
      }),
    ).toEqual([]);
  });

  it('flags a register entry the teacher acted on, not a bare observation', () => {
    const observed = flagStudents({
      roster: [student('a', 1)],
      window: { attendance: [], behavior: [behavior('a', { entries: 2, withAction: 0 })] },
      term: emptyTerm,
    });
    expect(observed).toEqual([]);

    const acted = flagStudents({
      roster: [student('a', 1)],
      window: { attendance: [], behavior: [behavior('a', { entries: 1, withAction: 1 })] },
      term: emptyTerm,
    });
    expect(acted[0].reasons).toEqual([
      { kind: 'behavior', scope: 'window', value: 1, threshold: 1 },
    ]);
  });

  it('flags a conduct balance below the line, reading it the other way round', () => {
    const [row] = flagStudents({
      roster: [student('a', 1)],
      window: empty,
      term: {
        attendance: [],
        behavior: [],
        conduct: [{ studentId: 'a', deducted: 25, remaining: 75 }],
      },
    });

    expect(row.reasons).toEqual([{ kind: 'conduct', scope: 'term', value: 75, threshold: 85 }]);
    expect(row.term.conductRemaining).toBe(75);
  });

  it('puts the term’s cases first, then the worst, then the roll', () => {
    const rows = flagStudents({
      roster: [student('a', 1), student('b', 2), student('c', 3)],
      window: {
        attendance: [
          attendance('a', { absentUnexcused: 1 }),
          attendance('c', { absentUnexcused: 1 }),
        ],
        behavior: [],
      },
      term: {
        attendance: [attendance('b', { absentUnexcused: 9 })],
        behavior: [],
        conduct: [],
      },
    });

    expect(rows.map((row) => row.studentId)).toEqual(['b', 'a', 'c']);
    expect(rows.map((row) => row.severity)).toEqual(['act', 'watch', 'watch']);
  });

  it('carries the counts through, so the sheet needs no second read', () => {
    const [row] = flagStudents({
      roster: [student('a', 1)],
      window: {
        attendance: [attendance('a', { absentUnexcused: 2, late: 1 })],
        behavior: [behavior('a', { entries: 2, withAction: 1 })],
      },
      term: {
        attendance: [attendance('a', { absentUnexcused: 7, late: 4, attendanceRate: 78 })],
        behavior: [behavior('a', { entries: 5, withAction: 3 })],
        conduct: [{ studentId: 'a', deducted: 30, remaining: 70 }],
      },
    });

    expect(row.window).toEqual({
      absentUnexcused: 2,
      late: 1,
      absentExcused: 0,
      behaviorEntries: 2,
      behaviorWithAction: 1,
    });
    expect(row.term).toMatchObject({
      absentUnexcused: 7,
      attendanceRate: 78,
      behaviorWithAction: 3,
      conductRemaining: 70,
    });
  });

  it('ignores facts for a child who is not on the roll', () => {
    expect(
      flagStudents({
        roster: [student('a', 1)],
        window: { attendance: [attendance('gone', { absentUnexcused: 9 })], behavior: [] },
        term: emptyTerm,
      }),
    ).toEqual([]);
  });

  it('treats a threshold of zero as "do not flag on this at all"', () => {
    expect(
      flagStudents({
        roster: [student('a', 1)],
        window: { attendance: [attendance('a', { absentUnexcused: 2 })], behavior: [] },
        term: emptyTerm,
        thresholds: {
          window: { absentDays: 0, lates: 0, behaviorEntries: 0 },
          term: { ...DEFAULT_REVIEW_THRESHOLDS.term, absentDays: 0 },
        },
      }),
    ).toEqual([]);
  });
});

describe('normalizeThresholds', () => {
  it('falls back to the defaults for anything missing', () => {
    expect(normalizeThresholds(undefined)).toEqual(DEFAULT_REVIEW_THRESHOLDS);
    expect(normalizeThresholds({ window: { lates: 4 } })).toEqual({
      window: { ...DEFAULT_REVIEW_THRESHOLDS.window, lates: 4 },
      term: DEFAULT_REVIEW_THRESHOLDS.term,
    });
  });

  it('refuses a value that is not a usable number', () => {
    const thresholds = normalizeThresholds({
      window: { absentDays: 'two', lates: -1, behaviorEntries: Number.NaN },
    });
    expect(thresholds.window).toEqual(DEFAULT_REVIEW_THRESHOLDS.window);
  });

  it('keeps an explicit zero, which switches one rule off', () => {
    expect(normalizeThresholds({ term: { conductPointsBelow: 0 } }).term.conductPointsBelow).toBe(
      0,
    );
  });
});
