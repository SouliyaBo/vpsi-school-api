import {
  attendanceGapMessage,
  behaviorGapMessage,
  homeroomFollowUpMessage,
} from './reminder-messages';

/**
 * The wording, on its own.
 *
 * What is worth pinning down is not the phrasing — the office will change that —
 * but the two rules underneath it: nobody who is up to date is messaged, and a
 * gap always says which day it is, because "you are behind on 3 lessons" sends a
 * teacher hunting through a week of timetable.
 */
describe('reminder messages', () => {
  describe('the attendance gap', () => {
    it('says nothing at all when nothing is owed', () => {
      expect(attendanceGapMessage([])).toBeNull();
    });

    it('names the days rather than counting them', () => {
      const message = attendanceGapMessage([
        {
          subjectNameLo: 'ພາສາລາວ',
          classroomName: 'ມ.1/ກ',
          missingDates: ['2026-09-22', '2026-09-24'],
        },
      ]);

      expect(message?.bodyLo).toContain('22/09, 24/09');
      expect(message?.bodyLo).toContain('ພາສາລາວ');
      expect(message?.bodyLo).toContain('ມ.1/ກ');
    });

    it('lists every lesson behind, not just the first', () => {
      const message = attendanceGapMessage([
        { subjectNameLo: 'ພາສາລາວ', classroomName: 'ມ.1/ກ', missingDates: ['2026-09-22'] },
        { subjectNameLo: 'ຄະນິດສາດ', classroomName: 'ມ.2/ຂ', missingDates: ['2026-09-23'] },
      ]);

      expect(message?.bodyLo).toContain('ພາສາລາວ');
      expect(message?.bodyLo).toContain('ຄະນິດສາດ');
    });
  });

  describe('the behaviour gap', () => {
    it('says nothing when the week is covered', () => {
      expect(behaviorGapMessage([])).toBeNull();
    });

    it('names each class once, however many of its lessons are unwritten', () => {
      const message = behaviorGapMessage([
        { subjectNameLo: 'ພາສາລາວ', classroomName: 'ມ.1/ກ', missingDates: ['2026-09-22'] },
        { subjectNameLo: 'ຄະນິດສາດ', classroomName: 'ມ.1/ກ', missingDates: ['2026-09-23'] },
      ]);

      expect(message?.bodyLo.match(/ມ\.1\/ກ/g)).toHaveLength(1);
    });
  });

  describe('the homeroom follow-up', () => {
    it('says nothing to a teacher who is nobody’s homeroom teacher', () => {
      expect(homeroomFollowUpMessage([])).toBeNull();
    });

    it('names the room and how many are in it', () => {
      const message = homeroomFollowUpMessage([{ classroomName: 'ມ.3/ກ', studentCount: 24 }]);

      expect(message?.bodyLo).toContain('ມ.3/ກ');
      expect(message?.bodyLo).toContain('24');
    });
  });
});

describe('reminder text for a lesson that was covered', () => {
  it('says the roll call belongs to cover, not to the teacher’s own timetable', () => {
    const text = attendanceGapMessage([
      {
        subjectNameLo: 'ຄະນິດສາດ',
        classroomName: 'ມ.4/ກ',
        missingDates: ['2026-09-29'],
        isSubstitute: true,
      },
    ]);

    // Without this, a teacher who stood in on Tuesday is chased over a class that
    // is not theirs on any timetable they have seen — and reads the app as broken.
    expect(text?.bodyLo).toContain('ສອນແທນ');
  });

  it('leaves an ordinary gap worded exactly as before', () => {
    const lesson = {
      subjectNameLo: 'ຄະນິດສາດ',
      classroomName: 'ມ.4/ກ',
      missingDates: ['2026-09-29'],
    };

    expect(attendanceGapMessage([lesson])?.bodyLo).not.toContain('ສອນແທນ');
    expect(behaviorGapMessage([lesson])?.bodyLo).not.toContain('ສອນແທນ');
  });
});
