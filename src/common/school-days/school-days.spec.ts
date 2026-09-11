import {
  hoursLate,
  recordingDeadline,
  SchoolDayCalendar,
  type SchoolDayEvent,
} from './school-days';

/**
 * The dates are the school's own 2026–2027 calendar, because the rules being
 * tested are the ones that sheet states and the cases that broke the reports are
 * the ones it prints: a Friday lesson before a weekend, a Monday holiday, an exam
 * week the office suspended the timetable for, and the twenty days of ບຸນປີໃໝ່.
 */
const events: SchoolDayEvent[] = [
  {
    titleLo: 'ວັນພັກຄູ',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-10-07',
    endDate: '2026-10-07',
  },
  {
    titleLo: 'ວັນຄູແຫ່ງຊາດ',
    type: 'celebration',
    dayEffect: 'open',
    startDate: '2026-10-06',
    endDate: '2026-10-06',
  },
  {
    titleLo: 'ສອບເສັງກາງພາກ',
    type: 'exam',
    dayEffect: 'no_classes',
    startDate: '2026-12-08',
    endDate: '2026-12-15',
  },
  {
    titleLo: 'ພັກບຸນປີໃໝ່ລາວ',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2027-04-12',
    endDate: '2027-04-19',
  },
  {
    titleLo: 'ວັນຮຽນສຸດທ້າຍ',
    type: 'year_end_program',
    dayEffect: 'open',
    startDate: '2027-06-10',
    endDate: '2027-06-10',
    isHalfDay: true,
  },
];

const calendar = new SchoolDayCalendar(events, {
  yearStart: '2026-08-17',
  yearEnd: '2027-06-10',
});

describe('SchoolDayCalendar', () => {
  it('treats an ordinary weekday as a teaching day', () => {
    const day = calendar.classify('2026-09-09');
    expect(day.state).toBe('teaching');
    expect(day.isTeachingDay).toBe(true);
    expect(day.isWorkingDay).toBe(true);
  });

  it('reports a weekend as a weekend rather than as a closure', () => {
    expect(calendar.classify('2026-09-12').state).toBe('weekend');
    expect(calendar.classify('2026-09-13').isTeachingDay).toBe(false);
  });

  it('closes a holiday and leaves the celebration beside it open', () => {
    expect(calendar.classify('2026-10-06').state).toBe('teaching');
    expect(calendar.classify('2026-10-07').state).toBe('closed');
  });

  it('counts an exam period as worked but not taught', () => {
    const day = calendar.classify('2026-12-10');
    expect(day.state).toBe('no_classes');
    expect(day.isTeachingDay).toBe(false);
    expect(day.isWorkingDay).toBe(true);
  });

  it('names what closed a day, so a report can say why', () => {
    expect(calendar.classify('2027-04-15').events[0].titleLo).toBe('ພັກບຸນປີໃໝ່ລາວ');
  });

  it('carries a half day', () => {
    expect(calendar.classify('2027-06-10').isHalfDay).toBe(true);
    expect(calendar.classify('2027-06-09').isHalfDay).toBe(false);
  });

  it('places dates outside the school year out of the year', () => {
    expect(calendar.classify('2026-08-14').state).toBe('out_of_year');
    expect(calendar.classify('2027-06-11').state).toBe('out_of_year');
  });

  it('counts only the days the timetable ran', () => {
    // Mon 7 Dec is taught; Tue 8 – Tue 15 is the exam period; Wed 16 – Fri 18 are
    // taught again, and 12/13 are a weekend inside the suspended stretch.
    expect(calendar.countTeachingDays('2026-12-07', '2026-12-18')).toBe(4);
  });
});

describe('recordingDeadline', () => {
  const at = (iso: string) => new Date(iso);

  it('gives a Wednesday lesson until Thursday noon, Vientiane time', () => {
    // 05:00Z is 12:00 in Vientiane, which is UTC+7 all year.
    expect(recordingDeadline('2026-09-09', calendar)?.toISOString()).toBe(
      '2026-09-10T05:00:00.000Z',
    );
  });

  it('gives a Friday lesson until Monday noon, not Saturday noon', () => {
    expect(recordingDeadline('2026-09-11', calendar)?.toISOString()).toBe(
      '2026-09-14T05:00:00.000Z',
    );
  });

  it('skips a holiday the lesson is followed by', () => {
    // Tue 6 Oct is taught, Wed 7 Oct is shut, so the deadline is Thursday noon.
    expect(recordingDeadline('2026-10-06', calendar)?.toISOString()).toBe(
      '2026-10-08T05:00:00.000Z',
    );
  });

  it('lands inside an exam week, because the staff are in', () => {
    // Mon 7 Dec's write-up is due Tue 8 Dec noon even though no lesson ran that day.
    expect(recordingDeadline('2026-12-07', calendar)?.toISOString()).toBe(
      '2026-12-08T05:00:00.000Z',
    );
  });

  it('waits out the whole of ບຸນປີໃໝ່', () => {
    // Fri 9 Apr is the last day taught; the school returns Tue 20 Apr.
    expect(recordingDeadline('2027-04-09', calendar)?.toISOString()).toBe(
      '2027-04-20T05:00:00.000Z',
    );
  });

  it('has no deadline to give past the end of the calendar', () => {
    expect(recordingDeadline('2027-06-10', calendar)).toBeNull();
  });

  it('measures lateness from the deadline and not from the lesson', () => {
    const deadline = recordingDeadline('2026-09-11', calendar);
    expect(deadline).not.toBeNull();
    // Written Monday 15:00 Vientiane — three hours past noon.
    expect(hoursLate(at('2026-09-14T08:00:00.000Z'), deadline!)).toBe(3);
    // Written Saturday, which is early rather than late.
    expect(hoursLate(at('2026-09-12T03:00:00.000Z'), deadline!)).toBe(0);
  });
});
