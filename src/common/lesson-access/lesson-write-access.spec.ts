import { Types } from 'mongoose';
import {
  canWriteLesson,
  periodsOnDate,
  responsibleTeacher,
  substitutionKey,
  type LessonSubstitute,
} from './lesson-write-access';

const LESSON = { teacherId: 't1' };

const teacher = (personId: string | null) => ({ personType: 'teacher', personId });
const office = { personType: 'staff', personId: null };

describe('canWriteLesson', () => {
  it('lets the timetabled teacher write their own lesson', () => {
    expect(canWriteLesson(LESSON, teacher('t1'))).toBe(true);
  });

  it('refuses a teacher reaching for a colleague’s lesson', () => {
    expect(canWriteLesson(LESSON, teacher('t9'))).toBe(false);
  });

  it('lets the teacher who claimed cover write that lesson', () => {
    expect(canWriteLesson(LESSON, teacher('t9'), { substituteTeacherId: 't9' })).toBe(true);
  });

  it('does not let a claim admit anybody other than the stand-in named on it', () => {
    // The claim is not a key to the lesson; it is a key held by one person.
    expect(canWriteLesson(LESSON, teacher('t8'), { substituteTeacherId: 't9' })).toBe(false);
  });

  it('leaves the office able to record on a teacher’s behalf', () => {
    // Unchanged, and load-bearing: it is how a register gets keyed in from a paper
    // note for a teacher who has left.
    expect(canWriteLesson(LESSON, office)).toBe(true);
  });

  it('refuses a teacher account with no teacher on file', () => {
    expect(canWriteLesson(LESSON, teacher(null))).toBe(false);
  });

  /**
   * The bug this exists to prevent.
   *
   * `@Prop({ type: SchemaTypes.ObjectId })` means every id off a document is an
   * `ObjectId`, and `===` against the string id on a session is always false — so a
   * gate written the obvious way would refuse the lesson's own teacher, silently.
   */
  it('compares ids through String, so an ObjectId matches a session’s string id', () => {
    const teacherId = new Types.ObjectId();
    const actor = teacher(teacherId.toString());

    expect(canWriteLesson({ teacherId }, actor)).toBe(true);
    expect(canWriteLesson({ teacherId: new Types.ObjectId() }, actor, { teacherId } as never)).toBe(
      false,
    );
    expect(
      canWriteLesson({ teacherId: new Types.ObjectId() }, actor, {
        substituteTeacherId: teacherId,
      }),
    ).toBe(true);
  });
});

describe('responsibleTeacher', () => {
  const owner = {
    teachingAssignmentId: 'ta1',
    teacherId: 't1',
    teacherCode: 'T-001',
    teacherName: 'ບຸນມີ ແກ້ວ',
  };
  const stand: LessonSubstitute = {
    teacherId: 't9',
    teacherCode: 'T-009',
    teacherName: 'ຄຳຫລ້າ ວົງສາ',
  };

  it('answers the timetabled teacher when nobody stood in', () => {
    expect(responsibleTeacher(owner, '2026-09-07')).toEqual({
      teacherId: 't1',
      teacherCode: 'T-001',
      teacherName: 'ບຸນມີ ແກ້ວ',
    });
  });

  it('answers the stand-in on the day they covered, and only that day', () => {
    const index = new Map([[substitutionKey('ta1', '2026-09-07'), stand]]);

    expect(responsibleTeacher(owner, '2026-09-07', index)).toEqual(stand);
    // The same lesson, a week later: back to the teacher it belongs to.
    expect(responsibleTeacher(owner, '2026-09-14', index).teacherId).toBe('t1');
  });

  it('keys cover to the lesson as well as the day', () => {
    const index = new Map([[substitutionKey('ta1', '2026-09-07'), stand]]);

    // Cover for maths on Monday says nothing about the Lao lesson that morning.
    expect(
      responsibleTeacher({ ...owner, teachingAssignmentId: 'ta2' }, '2026-09-07', index),
    ).toMatchObject({ teacherId: 't1' });
  });

  it('takes a Date or a day string, since the reports hold both', () => {
    const index = new Map([[substitutionKey('ta1', '2026-09-07'), stand]]);

    expect(responsibleTeacher(owner, new Date('2026-09-07T00:00:00.000Z'), index)).toEqual(stand);
  });
});

describe('periodsOnDate', () => {
  it('reads the weekday in UTC, so a server west of UTC does not shift the day', () => {
    // 2026-09-07 is a Monday. `getDay()` on a machine at UTC-7 would say Sunday.
    const monday = new Date('2026-09-07T00:00:00.000Z');

    expect(periodsOnDate([{ dayOfWeek: 1, periodNumber: 3 }], monday)).toEqual([
      { dayOfWeek: 1, periodNumber: 3 },
    ]);
    expect(periodsOnDate([{ dayOfWeek: 0 }], monday)).toEqual([]);
  });

  it('returns both periods of a lesson taught twice in one day', () => {
    const monday = new Date('2026-09-07T00:00:00.000Z');
    const schedule = [
      { dayOfWeek: 1, startTime: '08:00' },
      { dayOfWeek: 1, startTime: '13:00' },
      { dayOfWeek: 3, startTime: '08:00' },
    ];

    expect(periodsOnDate(schedule, monday)).toHaveLength(2);
  });
});
