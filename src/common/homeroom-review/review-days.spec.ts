import { SchoolDayCalendar, type SchoolDayEvent } from '../school-days/school-days';
import {
  buildReviewCompliance,
  currentReviewDay,
  reviewDaysIn,
  statusFor,
  type FiledReview,
  type ReviewSubject,
} from './review-days';

/**
 * September 2026, which is what the live term runs in:
 * Mon 21, Tue 22, Wed 23, Thu 24, Fri 25, Sat 26, Sun 27.
 */
const calendar = (events: SchoolDayEvent[] = []) => new SchoolDayCalendar(events);

const holiday = (from: string, to = from): SchoolDayEvent => ({
  id: from,
  titleLo: 'ພັກ',
  titleEn: 'Holiday',
  type: 'holiday',
  dayEffect: 'closed',
  startDate: new Date(`${from}T00:00:00.000Z`),
  endDate: new Date(`${to}T00:00:00.000Z`),
  isHalfDay: false,
});

const room = (over: Partial<ReviewSubject> = {}): ReviewSubject => ({
  classroomId: 'c1',
  classroomName: 'ມ.1/ກ',
  gradeLevelCode: 'm1',
  teacherId: 't1',
  teacherCode: 'T-2627-001',
  teacherName: 'ສົມເພັດ ພັນໂນລາດ',
  studentsOnRoll: 24,
  ...over,
});

const filed = (over: Partial<FiledReview> = {}): FiledReview => ({
  classroomId: 'c1',
  dueDate: '2026-09-23',
  reviewedAt: new Date('2026-09-23T10:30:00.000Z'),
  studentsFlagged: 3,
  studentsActioned: 2,
  guardiansContacted: 1,
  ...over,
});

describe('reviewDaysIn', () => {
  it('owes the Wednesday and the Friday of a week, and nothing else', () => {
    const days = reviewDaysIn({ start: '2026-09-21', end: '2026-09-27' }, calendar());
    expect(days.map((day) => day.date)).toEqual(['2026-09-23', '2026-09-25']);
  });

  it('opens the first window at the start and each later one the day after the last review', () => {
    const days = reviewDaysIn({ start: '2026-09-21', end: '2026-09-27' }, calendar());
    expect(days[0]).toMatchObject({ windowStart: '2026-09-21', windowEnd: '2026-09-23' });
    expect(days[1]).toMatchObject({ windowStart: '2026-09-24', windowEnd: '2026-09-25' });
  });

  it('carries on from the last review day before the window', () => {
    const days = reviewDaysIn(
      { start: '2026-09-21', end: '2026-09-23', previousReviewDay: '2026-09-18' },
      calendar(),
    );
    expect(days[0]).toMatchObject({ windowStart: '2026-09-21', windowEnd: '2026-09-23' });
  });

  it('owes nothing on a review day the school was shut, and gives its days to the next one', () => {
    const days = reviewDaysIn(
      { start: '2026-09-21', end: '2026-09-27' },
      calendar([holiday('2026-09-23')]),
    );
    // Wednesday is not owed at all, and Friday's sheet covers Monday to Friday
    // rather than leaving three days nobody ever looked at.
    expect(days.map((day) => day.date)).toEqual(['2026-09-25']);
    expect(days[0]).toMatchObject({ windowStart: '2026-09-21', windowEnd: '2026-09-25' });
  });

  it('sets the deadline at noon Vientiane of the next working day', () => {
    const [wednesday, friday] = reviewDaysIn(
      { start: '2026-09-21', end: '2026-09-27' },
      calendar(),
    );
    // Thursday noon Vientiane = 05:00 UTC.
    expect(wednesday.deadline?.toISOString()).toBe('2026-09-24T05:00:00.000Z');
    // Friday's is Monday's noon, not Saturday's.
    expect(friday.deadline?.toISOString()).toBe('2026-09-28T05:00:00.000Z');
  });

  it('returns nothing for a backwards window', () => {
    expect(reviewDaysIn({ start: '2026-09-27', end: '2026-09-21' }, calendar())).toEqual([]);
  });
});

describe('currentReviewDay', () => {
  const days = reviewDaysIn({ start: '2026-09-21', end: '2026-09-27' }, calendar());

  it('is the review day itself when the teacher opens the sheet that day', () => {
    expect(currentReviewDay(days, '2026-09-23')?.date).toBe('2026-09-23');
  });

  it('is still Wednesday on Thursday — the sheet being filed is Wednesday’s', () => {
    expect(currentReviewDay(days, '2026-09-24')?.date).toBe('2026-09-23');
  });

  it('is null before the first review day of the window', () => {
    expect(currentReviewDay(days, '2026-09-22')).toBeNull();
  });
});

describe('statusFor', () => {
  const [wednesday] = reviewDaysIn({ start: '2026-09-21', end: '2026-09-27' }, calendar());

  it('is pending while the deadline has not passed and nothing is on file', () => {
    expect(statusFor(wednesday, undefined, new Date('2026-09-23T09:00:00.000Z')).status).toBe(
      'pending',
    );
  });

  it('is missing once the deadline has passed with nothing on file', () => {
    expect(statusFor(wednesday, undefined, new Date('2026-09-24T06:00:00.000Z')).status).toBe(
      'missing',
    );
  });

  it('is confirmed for a review filed before the deadline', () => {
    const cell = statusFor(wednesday, filed(), new Date('2026-09-24T06:00:00.000Z'));
    expect(cell).toMatchObject({ status: 'confirmed', hoursLate: 0, guardiansContacted: 1 });
  });

  it('is late for one filed after it, and says by how much', () => {
    const cell = statusFor(
      wednesday,
      filed({ reviewedAt: new Date('2026-09-25T05:00:00.000Z') }),
      new Date('2026-09-25T06:00:00.000Z'),
    );
    expect(cell.status).toBe('late');
    expect(cell.hoursLate).toBe(24);
  });
});

describe('buildReviewCompliance', () => {
  const reviewDays = reviewDaysIn({ start: '2026-09-21', end: '2026-09-27' }, calendar());
  const window = { start: '2026-09-21', end: '2026-09-27', asOf: '2026-09-27' };
  // Both deadlines have passed.
  const now = new Date('2026-09-28T06:00:00.000Z');

  it('reports a room that filed one of two as half done', () => {
    const report = buildReviewCompliance({
      window,
      reviewDays,
      subjects: [room()],
      filed: [filed()],
      now,
    });

    expect(report.rows[0]).toMatchObject({
      due: 2,
      confirmed: 1,
      late: 0,
      missing: 1,
      reviewRate: 50,
      onTimeRate: 100,
      guardiansContacted: 1,
    });
    expect(report.summary).toMatchObject({ classroomsBehind: 1, teachersBehind: 1 });
  });

  it('starts from the rooms, so a room with nothing on file is a row and not an absence', () => {
    const report = buildReviewCompliance({
      window,
      reviewDays,
      subjects: [room(), room({ classroomId: 'c2', classroomName: 'ມ.1/ຂ', teacherId: 't2' })],
      filed: [],
      now,
    });

    expect(report.rows).toHaveLength(2);
    expect(report.summary).toMatchObject({ due: 4, confirmed: 0, missing: 4, reviewRate: 0 });
  });

  it('counts a room with no homeroom teacher, and says so', () => {
    const report = buildReviewCompliance({
      window,
      reviewDays,
      subjects: [room({ teacherId: null, teacherCode: null, teacherName: null })],
      filed: [],
      now,
    });

    expect(report.summary.classroomsUnassigned).toBe(1);
    // Nobody to chase, so it is not counted against a teacher.
    expect(report.summary.teachersBehind).toBe(0);
    expect(report.summary.classroomsBehind).toBe(1);
  });

  it('leaves a review day whose deadline has not passed out of what is owed', () => {
    const report = buildReviewCompliance({
      window,
      reviewDays,
      subjects: [room()],
      filed: [],
      // Wednesday afternoon: Wednesday is not yet late and Friday is days away.
      now: new Date('2026-09-23T09:00:00.000Z'),
    });

    expect(report.rows[0]).toMatchObject({ due: 0, missing: 0, pending: 2, reviewRate: 0 });
    expect(report.summary.classroomsBehind).toBe(0);
  });

  it('holds the same room’s two sheets apart by the day each answers for', () => {
    const report = buildReviewCompliance({
      window,
      reviewDays,
      subjects: [room()],
      filed: [
        filed(),
        filed({ dueDate: '2026-09-25', reviewedAt: new Date('2026-09-28T07:00:00.000Z') }),
      ],
      now,
    });

    expect(report.rows[0].days.map((day) => day.status)).toEqual(['confirmed', 'late']);
    expect(report.rows[0]).toMatchObject({ due: 2, reviewRate: 100, onTimeRate: 50 });
  });
});
