import { SchedulePeriod } from 'src/database/schemas';
import {
  findScheduleConflicts,
  findSelfOverlaps,
  periodsOverlap,
  sharesRotation,
} from './schedule-conflict';

const period = (
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  room?: string,
): SchedulePeriod => ({ dayOfWeek, startTime, endTime, room: room ?? null });

/** The same period, declared part of the school's two-teacher swap. */
const rotating = (
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  room?: string,
): SchedulePeriod => ({ ...period(dayOfWeek, startTime, endTime, room), isRotating: true });

describe('periodsOverlap', () => {
  it('is false for periods on different days', () => {
    expect(periodsOverlap(period(1, '08:00', '09:00'), period(2, '08:00', '09:00'))).toBe(false);
  });

  it('is true for identical periods', () => {
    expect(periodsOverlap(period(1, '08:00', '09:00'), period(1, '08:00', '09:00'))).toBe(true);
  });

  it('is true for partial overlap', () => {
    expect(periodsOverlap(period(1, '08:00', '09:00'), period(1, '08:30', '09:30'))).toBe(true);
  });

  it('is false for back-to-back periods', () => {
    // The normal timetable pattern: one period ends exactly as the next begins.
    // Treating this as a clash would make consecutive lessons impossible.
    expect(periodsOverlap(period(1, '08:00', '08:50'), period(1, '08:50', '09:40'))).toBe(false);
  });

  it('is true when one period fully contains the other', () => {
    expect(periodsOverlap(period(3, '08:00', '12:00'), period(3, '09:00', '10:00'))).toBe(true);
  });

  it('is symmetric', () => {
    const a = period(1, '08:00', '09:00');
    const b = period(1, '08:30', '09:30');
    expect(periodsOverlap(a, b)).toBe(periodsOverlap(b, a));
  });

  it('compares times correctly across the 10:00 boundary', () => {
    // Zero-padded HH:mm compares lexicographically in time order; unpadded
    // strings would put "9:00" after "10:00".
    expect(periodsOverlap(period(1, '09:00', '10:00'), period(1, '09:30', '11:00'))).toBe(true);
    expect(periodsOverlap(period(1, '09:00', '10:00'), period(1, '10:00', '11:00'))).toBe(false);
  });
});

describe('sharesRotation', () => {
  it('is true only when both periods declare the swap', () => {
    expect(sharesRotation(rotating(5, '14:00', '14:50'), rotating(5, '14:00', '14:50'))).toBe(true);
    expect(sharesRotation(rotating(5, '14:00', '14:50'), period(5, '14:00', '14:50'))).toBe(false);
    expect(sharesRotation(period(5, '14:00', '14:50'), period(5, '14:00', '14:50'))).toBe(false);
  });

  it('treats a period stored before the field existed as not rotating', () => {
    // `.lean()` skips Mongoose defaults, so an older document arrives without it.
    const legacy = { dayOfWeek: 5, startTime: '14:00', endTime: '14:50' } as SchedulePeriod;
    expect(sharesRotation(legacy, rotating(5, '14:00', '14:50'))).toBe(false);
  });
});

describe('findSelfOverlaps', () => {
  it('finds no overlap in a valid schedule', () => {
    expect(findSelfOverlaps([period(1, '08:00', '08:50'), period(1, '09:00', '09:50')])).toEqual(
      [],
    );
  });

  it('finds a schedule that overlaps itself', () => {
    expect(findSelfOverlaps([period(1, '08:00', '09:00'), period(1, '08:30', '09:30')])).toEqual([
      [0, 1],
    ]);
  });

  it('allows the same time on different days', () => {
    expect(findSelfOverlaps([period(1, '08:00', '09:00'), period(2, '08:00', '09:00')])).toEqual(
      [],
    );
  });
});

describe('findScheduleConflicts', () => {
  const requested = {
    teacherId: 'teacher-1',
    classroomId: 'class-A',
    schedule: [period(1, '08:00', '09:00', 'R101')],
  };

  it('returns nothing when there are no existing assignments', () => {
    expect(findScheduleConflicts(requested, [])).toEqual([]);
  });

  it('detects the same teacher double-booked', () => {
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-1',
        teacherId: 'teacher-1',
        classroomId: 'class-B',
        schedule: [period(1, '08:30', '09:30', 'R202')],
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('teacher');
    expect(conflicts[0].assignmentId).toBe('existing-1');
  });

  it('detects the same classroom double-booked', () => {
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-2',
        teacherId: 'teacher-9',
        classroomId: 'class-A',
        schedule: [period(1, '08:30', '09:30', 'R303')],
      },
    ]);

    expect(conflicts.map((c) => c.kind)).toEqual(['classroom']);
  });

  it('detects the same physical room double-booked', () => {
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-3',
        teacherId: 'teacher-9',
        classroomId: 'class-Z',
        schedule: [period(1, '08:30', '09:30', 'R101')],
      },
    ]);

    expect(conflicts.map((c) => c.kind)).toEqual(['room']);
  });

  it('reports every kind that applies to one overlap', () => {
    // Same teacher, same class, same room — all three constraints break at once.
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-4',
        teacherId: 'teacher-1',
        classroomId: 'class-A',
        schedule: [period(1, '08:00', '09:00', 'R101')],
      },
    ]);

    expect(conflicts.map((c) => c.kind).sort()).toEqual(['classroom', 'room', 'teacher']);
  });

  it('ignores a shared room when the requested period names no room', () => {
    const noRoom = { ...requested, schedule: [period(1, '08:00', '09:00')] };
    const conflicts = findScheduleConflicts(noRoom, [
      {
        id: 'existing-5',
        teacherId: 'teacher-9',
        classroomId: 'class-Z',
        schedule: [period(1, '08:30', '09:30', 'R101')],
      },
    ]);

    // An unspecified room asserts nothing, so there is nothing to clash with.
    expect(conflicts).toEqual([]);
  });

  it('ignores a shared room when the existing period names no room', () => {
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-6',
        teacherId: 'teacher-9',
        classroomId: 'class-Z',
        schedule: [period(1, '08:30', '09:30')],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('allows a different teacher, class and room at the same time', () => {
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-7',
        teacherId: 'teacher-2',
        classroomId: 'class-B',
        schedule: [period(1, '08:00', '09:00', 'R202')],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('allows back-to-back periods for the same teacher', () => {
    const conflicts = findScheduleConflicts(
      { teacherId: 'teacher-1', classroomId: 'class-A', schedule: [period(1, '08:00', '08:50')] },
      [
        {
          id: 'existing-8',
          teacherId: 'teacher-1',
          classroomId: 'class-B',
          schedule: [period(1, '08:50', '09:40')],
        },
      ],
    );
    expect(conflicts).toEqual([]);
  });

  it('checks every requested period against every existing one', () => {
    const multiPeriod = {
      teacherId: 'teacher-1',
      classroomId: 'class-A',
      schedule: [period(1, '08:00', '09:00'), period(3, '10:00', '11:00')],
    };

    const conflicts = findScheduleConflicts(multiPeriod, [
      {
        id: 'existing-9',
        teacherId: 'teacher-1',
        classroomId: 'class-B',
        schedule: [period(3, '10:30', '11:30')],
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].dayOfWeek).toBe(3);
  });

  /**
   * The school's Friday swap: ຄະນິດສາດ and ພາສາລາວ share the last period across
   * ມ.2/ກ and ມ.2/ຂ, and the two teachers trade classes. All four arrangements
   * are stored, so the slot has to survive the clash check that each of them
   * would otherwise trip.
   */
  describe('a rotating slot', () => {
    const FRIDAY = 5;
    const viengphoneMathsA = {
      teacherId: 'viengphone',
      classroomId: 'm2-a',
      schedule: [rotating(FRIDAY, '14:00', '14:50')],
    };

    it('lets one teacher hold the slot in two classes at once', () => {
      const conflicts = findScheduleConflicts(viengphoneMathsA, [
        {
          id: 'viengphone-maths-b',
          teacherId: 'viengphone',
          classroomId: 'm2-b',
          schedule: [rotating(FRIDAY, '14:00', '14:50')],
        },
      ]);

      expect(conflicts).toEqual([]);
    });

    it('lets one class hold two lessons in the slot', () => {
      const conflicts = findScheduleConflicts(viengphoneMathsA, [
        {
          id: 'na-lao-a',
          teacherId: 'na',
          classroomId: 'm2-a',
          schedule: [rotating(FRIDAY, '14:00', '14:50')],
        },
      ]);

      expect(conflicts).toEqual([]);
    });

    it('waives the room clash too, since the swap reuses the same rooms', () => {
      const conflicts = findScheduleConflicts(
        { ...viengphoneMathsA, schedule: [rotating(FRIDAY, '14:00', '14:50', 'R101')] },
        [
          {
            id: 'na-lao-a',
            teacherId: 'na',
            classroomId: 'm2-a',
            schedule: [rotating(FRIDAY, '14:00', '14:50', 'R101')],
          },
        ],
      );

      expect(conflicts).toEqual([]);
    });

    it('takes the whole four-way slot without a single complaint', () => {
      const others = [
        { id: 'na-lao-b', teacherId: 'na', classroomId: 'm2-b' },
        { id: 'na-lao-a', teacherId: 'na', classroomId: 'm2-a' },
        { id: 'viengphone-maths-b', teacherId: 'viengphone', classroomId: 'm2-b' },
      ].map((row) => ({ ...row, schedule: [rotating(FRIDAY, '14:00', '14:50')] }));

      expect(findScheduleConflicts(viengphoneMathsA, others)).toEqual([]);
    });

    it('still clashes with an ordinary lesson in the same slot', () => {
      // The exemption is mutual. Otherwise one tick would park a second class on
      // top of a real lesson that never agreed to share.
      const conflicts = findScheduleConflicts(viengphoneMathsA, [
        {
          id: 'ordinary-lesson',
          teacherId: 'lindar',
          classroomId: 'm2-a',
          schedule: [period(FRIDAY, '14:00', '14:50')],
        },
      ]);

      expect(conflicts.map((c) => c.kind)).toEqual(['classroom']);
    });

    it('reports a half-marked swap as such, not as a plain double-booking', () => {
      // The case a human actually hits: the new lesson is ticked, the one
      // recorded before the tick existed is not. Calling that "the teacher is
      // double-booked" sends them looking for a clash that is not the problem.
      const conflicts = findScheduleConflicts(viengphoneMathsA, [
        {
          id: 'recorded-before-the-tick-existed',
          teacherId: 'viengphone',
          classroomId: 'm2-b',
          schedule: [period(FRIDAY, '14:00', '14:50')],
        },
      ]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].kind).toBe('teacher');
      expect(conflicts[0].rotationMismatch).toBe(true);
      expect(conflicts[0].assignmentId).toBe('recorded-before-the-tick-existed');
    });

    it('does not call a clash between two ordinary lessons a swap problem', () => {
      const conflicts = findScheduleConflicts(
        {
          teacherId: 'viengphone',
          classroomId: 'm2-a',
          schedule: [period(FRIDAY, '14:00', '14:50')],
        },
        [
          {
            id: 'ordinary-lesson',
            teacherId: 'viengphone',
            classroomId: 'm2-b',
            schedule: [period(FRIDAY, '14:00', '14:50')],
          },
        ],
      );

      expect(conflicts[0].rotationMismatch).toBe(false);
    });

    it('is not exempt outside the slot it was marked on', () => {
      // Only the marked period rotates; the rest of the same assignment does not.
      const mixed = {
        teacherId: 'viengphone',
        classroomId: 'm2-a',
        schedule: [rotating(FRIDAY, '14:00', '14:50'), period(1, '08:00', '08:50')],
      };

      const conflicts = findScheduleConflicts(mixed, [
        {
          id: 'monday-lesson',
          teacherId: 'viengphone',
          classroomId: 'm2-b',
          schedule: [rotating(FRIDAY, '14:00', '14:50'), rotating(1, '08:00', '08:50')],
        },
      ]);

      expect(conflicts.map((c) => c.kind)).toEqual(['teacher']);
      expect(conflicts[0].dayOfWeek).toBe(1);
    });

    it('does not excuse a schedule that overlaps itself', () => {
      // One teacher, one subject, one class — nobody to take turns with.
      expect(
        findSelfOverlaps([rotating(FRIDAY, '14:00', '15:00'), rotating(FRIDAY, '14:30', '15:30')]),
      ).toEqual([[0, 1]]);
    });
  });

  it('includes both sides of the clash in the report', () => {
    const conflicts = findScheduleConflicts(requested, [
      {
        id: 'existing-10',
        teacherId: 'teacher-1',
        classroomId: 'class-B',
        schedule: [period(1, '08:30', '09:30', 'R202')],
      },
    ]);

    expect(conflicts[0].requested).toEqual({
      startTime: '08:00',
      endTime: '09:00',
      room: 'R101',
    });
    expect(conflicts[0].existing).toEqual({
      startTime: '08:30',
      endTime: '09:30',
      room: 'R202',
    });
  });
});
