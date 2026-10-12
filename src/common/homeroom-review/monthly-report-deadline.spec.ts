import {
  daysLate,
  reportDeadline,
  reportDueDate,
  reportOpensAt,
  reportStatus,
} from './monthly-report-deadline';

/** A Vientiane wall-clock time as an instant. */
const vte = (local: string) => new Date(`${local}+07:00`);

describe('the monthly report deadline', () => {
  it('is the end of the 5th of the next month, Vientiane time', () => {
    expect(reportDeadline(2026, 10)).toEqual(vte('2026-11-06T00:00:00'));
    expect(reportDueDate(2026, 10)).toBe('2026-11-05');
  });

  it('rolls December over into January of the next year', () => {
    expect(reportDeadline(2026, 12)).toEqual(vte('2027-01-06T00:00:00'));
    expect(reportDueDate(2026, 12)).toBe('2027-01-05');
  });

  it('opens on the last day of the month', () => {
    expect(reportOpensAt(2026, 10)).toEqual(vte('2026-10-31T00:00:00'));
    expect(reportOpensAt(2027, 2)).toEqual(vte('2027-02-28T00:00:00'));
  });
});

describe('reportStatus', () => {
  const now = vte('2026-11-20T10:00:00');

  it('is on time when sent late on the 5th', () => {
    expect(reportStatus(2026, 10, vte('2026-11-05T23:30:00'), now)).toBe('submitted');
  });

  it('is late when sent on the 6th', () => {
    expect(reportStatus(2026, 10, vte('2026-11-06T00:05:00'), now)).toBe('late');
  });

  it('is pending until the deadline passes, then missing', () => {
    expect(reportStatus(2026, 10, null, vte('2026-11-05T12:00:00'))).toBe('pending');
    expect(reportStatus(2026, 10, null, vte('2026-11-06T08:00:00'))).toBe('missing');
  });
});

describe('daysLate', () => {
  it('is 0 on time, and counts each day begun after the deadline', () => {
    expect(daysLate(2026, 10, vte('2026-11-04T09:00:00'), vte('2026-12-01T00:00:00'))).toBe(0);
    expect(daysLate(2026, 10, vte('2026-11-06T09:00:00'), vte('2026-12-01T00:00:00'))).toBe(1);
    expect(daysLate(2026, 10, vte('2026-11-08T09:00:00'), vte('2026-12-01T00:00:00'))).toBe(3);
  });

  it('counts an unsent report up to now', () => {
    expect(daysLate(2026, 10, null, vte('2026-11-07T09:00:00'))).toBe(2);
  });
});
