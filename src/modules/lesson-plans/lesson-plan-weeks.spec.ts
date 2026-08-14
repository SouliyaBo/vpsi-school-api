import {
  buildSemesterWeeks,
  DEFAULT_LESSON_PLAN_POLICY,
  deriveDueDate,
  endOfWeek,
  startOfWeek,
  weekKey,
} from './lesson-plan-weeks';

describe('startOfWeek', () => {
  it('leaves a Monday where it is', () => {
    expect(weekKey(startOfWeek('2025-09-15'))).toBe('2025-09-15');
  });

  it('snaps any weekday back to its Monday', () => {
    // Tue–Fri of the same week all resolve to the same column.
    for (const date of ['2025-09-16', '2025-09-17', '2025-09-18', '2025-09-19']) {
      expect(weekKey(startOfWeek(date))).toBe('2025-09-15');
    }
  });

  it('puts Sunday in the week that just ended, not the one starting next day', () => {
    // The school week is Mon–Fri, so a Sunday-dated plan belongs to the week it
    // closes. A Sunday-anchored week would file it against the wrong column.
    expect(weekKey(startOfWeek('2025-09-21'))).toBe('2025-09-15');
    expect(weekKey(startOfWeek('2025-09-22'))).toBe('2025-09-22');
  });

  it('is idempotent', () => {
    const once = startOfWeek('2025-09-18');
    expect(startOfWeek(once).getTime()).toBe(once.getTime());
  });

  it('normalizes away the clock time', () => {
    const snapped = startOfWeek('2025-09-17T23:45:00.000Z');
    expect(snapped.toISOString()).toBe('2025-09-15T00:00:00.000Z');
  });
});

describe('endOfWeek', () => {
  it('is the Sunday six days on', () => {
    expect(weekKey(endOfWeek(startOfWeek('2025-09-15')))).toBe('2025-09-21');
  });
});

describe('deriveDueDate', () => {
  it('lands on the Friday before a Monday week, at the policy time', () => {
    const due = deriveDueDate(startOfWeek('2025-09-15'), DEFAULT_LESSON_PLAN_POLICY);
    expect(due.toISOString()).toBe('2025-09-12T16:00:00.000Z');
  });

  it('honours a policy asking for a full week of notice', () => {
    const due = deriveDueDate(startOfWeek('2025-09-15'), {
      daysBeforeWeekStart: 7,
      dueTime: '09:30',
    });
    expect(due.toISOString()).toBe('2025-09-08T09:30:00.000Z');
  });

  it('is before the week it covers', () => {
    const weekStart = startOfWeek('2025-09-15');
    expect(deriveDueDate(weekStart, DEFAULT_LESSON_PLAN_POLICY).getTime()).toBeLessThan(
      weekStart.getTime(),
    );
  });
});

describe('buildSemesterWeeks', () => {
  it('numbers weeks from 1 and spans the term', () => {
    const weeks = buildSemesterWeeks(new Date('2025-09-01'), new Date('2025-09-28'));
    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toMatchObject({ index: 1 });
    expect(weekKey(weeks[0].startDate)).toBe('2025-09-01');
    expect(weekKey(weeks[3].startDate)).toBe('2025-09-22');
  });

  it('counts a term that opens mid-week as week 1', () => {
    // Term starts on a Wednesday; teachers still owe a plan for that week.
    const weeks = buildSemesterWeeks(new Date('2025-09-03'), new Date('2025-09-14'));
    expect(weekKey(weeks[0].startDate)).toBe('2025-09-01');
    expect(weeks).toHaveLength(2);
  });

  it('includes the week the term ends in even when it ends mid-week', () => {
    const weeks = buildSemesterWeeks(new Date('2025-09-01'), new Date('2025-09-10'));
    expect(weekKey(weeks[weeks.length - 1].startDate)).toBe('2025-09-08');
  });

  it('yields nothing when the end date precedes the start', () => {
    expect(buildSemesterWeeks(new Date('2025-09-28'), new Date('2025-09-01'))).toEqual([]);
  });

  it('caps a runaway range rather than looping forever', () => {
    const weeks = buildSemesterWeeks(new Date('2025-01-01'), new Date('2030-01-01'));
    expect(weeks).toHaveLength(60);
  });
});
