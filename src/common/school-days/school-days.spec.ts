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

/**
 * ຫຍຸດສະເພາະຊັ້ນ — the school stands one year or one room down without closing.
 *
 * ມ.7 sit a national exam, a room's teacher is away. The rest of the school
 * teaches that day and owes its registers; only the named classes do not. The
 * rule that makes this safe is the one asserted first: a question with no class
 * in it is answered by the school-wide events alone, so nothing here can empty
 * a register that was owed.
 */
describe('a day off for one class only', () => {
  const M1 = 'grade-m1';
  const M1A = 'room-m1a';
  const M1B = 'room-m1b';
  const M2A = 'room-m2a';

  const scoped = new SchoolDayCalendar([
    {
      titleLo: 'ມ.1 ຫຍຸດ',
      type: 'holiday',
      dayEffect: 'closed',
      startDate: '2026-09-15',
      endDate: '2026-09-15',
      appliesTo: { gradeLevelIds: [M1], classroomIds: [] },
    },
    {
      titleLo: 'ມ.2/ກ ຫຍຸດ',
      type: 'holiday',
      dayEffect: 'closed',
      startDate: '2026-09-16',
      endDate: '2026-09-16',
      appliesTo: { gradeLevelIds: [], classroomIds: [M2A] },
    },
    {
      titleLo: 'ພັກທົ່ວໂຮງຮຽນ',
      type: 'holiday',
      dayEffect: 'closed',
      startDate: '2026-09-17',
      endDate: '2026-09-17',
    },
  ]);

  it('leaves the school open on a day one year is off', () => {
    // The fact that protects every other register: asked without a class, a
    // class-scoped closure has nothing to say.
    expect(scoped.isTeachingDay('2026-09-15')).toBe(true);
    expect(scoped.classify('2026-09-15').events).toHaveLength(0);
  });

  it('closes every room of a grade level the office named', () => {
    expect(scoped.isTeachingDay('2026-09-15', { classroomId: M1A, gradeLevelId: M1 })).toBe(false);
    expect(scoped.isTeachingDay('2026-09-15', { classroomId: M1B, gradeLevelId: M1 })).toBe(false);
  });

  it('leaves the other years teaching that same day', () => {
    expect(scoped.isTeachingDay('2026-09-15', { classroomId: M2A, gradeLevelId: 'grade-m2' })).toBe(
      true,
    );
  });

  it('closes one room without closing its year', () => {
    expect(scoped.isTeachingDay('2026-09-16', { classroomId: M2A, gradeLevelId: 'grade-m2' })).toBe(
      false,
    );
    // The sibling room shares the grade level and is still taught — naming a
    // room must not take its year down with it.
    expect(
      scoped.isTeachingDay('2026-09-16', { classroomId: 'room-m2b', gradeLevelId: 'grade-m2' }),
    ).toBe(true);
  });

  it('still closes everybody on a school-wide holiday', () => {
    expect(scoped.isTeachingDay('2026-09-17')).toBe(false);
    expect(scoped.isTeachingDay('2026-09-17', { classroomId: M1A, gradeLevelId: M1 })).toBe(false);
    expect(scoped.isTeachingDay('2026-09-17', { classroomId: M2A, gradeLevelId: 'grade-m2' })).toBe(
      false,
    );
  });

  it('counts the year down one teaching day against the school', () => {
    // Mon 14 – Fri 18 Sep: the school teaches four (17 Sep is shut school-wide),
    // ມ.1 three — the day of its own closure comes off as well.
    expect(scoped.countTeachingDays('2026-09-14', '2026-09-18')).toBe(4);
    expect(
      scoped.countTeachingDays('2026-09-14', '2026-09-18', { classroomId: M1A, gradeLevelId: M1 }),
    ).toBe(3);
  });

  it('names the closure among the day’s events, so a report can say why', () => {
    const day = scoped.classify('2026-09-15', { classroomId: M1A, gradeLevelId: M1 });
    expect(day.events.map((event) => event.titleLo)).toEqual(['ມ.1 ຫຍຸດ']);
  });

  it('moves only that class’s deadline', () => {
    // Mon 14 Sep's write-up would be due Tue 15 Sep noon; ມ.1 is off that day, so
    // its deadline moves to Wednesday while everyone else's stays put.
    expect(recordingDeadline('2026-09-14', scoped)?.toISOString()).toBe('2026-09-15T05:00:00.000Z');
    expect(
      recordingDeadline('2026-09-14', scoped, {
        forClass: { classroomId: M1A, gradeLevelId: M1 },
      })?.toISOString(),
    ).toBe('2026-09-16T05:00:00.000Z');
  });
});
