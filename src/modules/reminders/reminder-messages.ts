/**
 * The words the reminders are made of.
 *
 * Plain text, and no knowledge of how it will be delivered. Each builder returns
 * the same `{ titleLo, bodyLo }` an in-app notification takes, so a reminder
 * goes out through the one notification path the rest of the system already
 * uses — which is what keeps the bell in the app and the message on the phone
 * saying the same thing. Escaping and bold belong to the Telegram channel.
 *
 * Lao only: this is a message to a Lao teacher's phone, and saying everything
 * twice makes the one line that matters harder to find.
 */

/** What a teacher is behind on, as the coverage report describes it. */
export interface GapLesson {
  subjectNameLo: string;
  classroomName: string;
  /** The elapsed lesson days with nothing written on them, `yyyy-MM-dd`. */
  missingDates: string[];
  /**
   * The gap is on a lesson this teacher covered, not one of their own.
   *
   * Said out loud in the message. A teacher who stood in for a colleague on
   * Tuesday and is then told they have not marked ຄະນິດສາດ ມ.4/ກ — a class that is
   * not theirs on any timetable they have ever seen — reads that as the app being
   * wrong, and the next reminder gets ignored along with it.
   */
  isSubstitute?: boolean;
}

/** One classroom a teacher is ຄູປະຈຳຫ້ອງ of, and what it is waiting for. */
export interface HomeroomClass {
  classroomName: string;
  studentCount: number;
  /** Children the review sheet would put in front of them right now. */
  flagged?: number;
  /**
   * Earlier review days still with nothing on file, `yyyy-MM-dd`.
   *
   * Named rather than counted, for the same reason the roll call's gaps are: "you
   * have missed 3" sends a teacher hunting, "16/09, 18/09" opens the right day.
   */
  missingDays?: string[];
}

export interface ReminderText {
  titleLo: string;
  bodyLo: string;
}

/** `2026-09-24` → `24/09` — the form the school writes dates in, minus the year. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

/**
 * "You have not marked these rolls."
 *
 * The days are named, not counted. A teacher told they are "behind on 3
 * lessons" has to go and find out which; a teacher told "22/09, 24/09" can open
 * the right day straight away. Returns `null` when there is nothing owed, which
 * is what stops a cheerful nag reaching somebody who is up to date — the
 * commonest way a reminder system gets muted.
 */
export function attendanceGapMessage(lessons: GapLesson[]): ReminderText | null {
  if (lessons.length === 0) return null;

  const lines = lessons.map(
    (lesson) =>
      `• ${lesson.subjectNameLo} — ${lesson.classroomName}` +
      `${lesson.isSubstitute ? ' (ສອນແທນ)' : ''}` +
      ` (${lesson.missingDates.map(shortDate).join(', ')})`,
  );

  return {
    titleLo: 'ຍັງບໍ່ໄດ້ເຊັກຊື່',
    bodyLo: [...lines, '', 'ກະລຸນາບັນທຶກການເຂົ້າຮຽນກ່ອນທ່ຽງຂອງວັນເຮັດວຽກຕໍ່ໄປ'].join('\n'),
  };
}

/**
 * "The behaviour register has nothing from you this week."
 *
 * Weekly rather than daily because that is how the register is owed — one entry
 * a week per class, not one a lesson — and a daily version of this would be
 * wrong four days out of five. Listed by class rather than by lesson for the
 * same reason: the class is the unit the register is written per.
 */
export function behaviorGapMessage(lessons: GapLesson[]): ReminderText | null {
  if (lessons.length === 0) return null;

  const classes = [
    ...new Set(
      lessons.map((lesson) => `${lesson.classroomName}${lesson.isSubstitute ? ' (ສອນແທນ)' : ''}`),
    ),
  ];

  return {
    titleLo: 'ຍັງບໍ່ໄດ້ບັນທຶກພຶດຕິກຳອາທິດນີ້',
    bodyLo: [
      ...classes.map((name) => `• ${name}`),
      '',
      'ກະລຸນາບັນທຶກພຶດຕິກຳນັກຮຽນກ່ອນສິ້ນອາທິດ',
    ].join('\n'),
  };
}

/**
 * "Go and look at your own class" — the ວັນພຸດ/ວັນສຸກ instruction.
 *
 * It used to go out to every homeroom teacher whether or not they had already
 * looked, which is the fastest way to teach people to ignore a reminder. Now the
 * caller hands in only the rooms with nothing on file for the current review day,
 * so a teacher who has already confirmed hears nothing at all.
 *
 * The flagged count is the reason to open it: "3 ຄົນຄວນເບິ່ງ" is a different
 * message from "go and check", and a room with nothing wrong says so, which is
 * still worth confirming.
 */
export function homeroomFollowUpMessage(classes: HomeroomClass[]): ReminderText | null {
  if (classes.length === 0) return null;

  const lines = classes.map((room) => {
    const flagged = room.flagged ?? 0;
    const detail =
      flagged > 0 ? `${flagged} ຄົນຄວນເບິ່ງ` : `${room.studentCount} ຄົນ — ບໍ່ພົບສິ່ງຜິດປົກກະຕິ`;
    return `• ${room.classroomName} (${detail})`;
  });

  return {
    titleLo: 'ຕິດຕາມນັກຮຽນຫ້ອງຂອງທ່ານ',
    bodyLo: [
      ...lines,
      '',
      'ກະລຸນາເຂົ້າລະບົບເພື່ອກວດການເຂົ້າຮຽນ ແລະ ພຶດຕິກຳ ແລ້ວກົດ "ຢືນຢັນການຕິດຕາມ"',
    ].join('\n'),
  };
}

/**
 * "You still have not confirmed, and the deadline is today at noon."
 *
 * Sent the morning after a review day, which is the only time this message can
 * still change the outcome: the deadline is noon of the next working day, so a
 * nag that evening would arrive after the day it is about had already been
 * counted missing.
 */
export function homeroomReviewOverdueMessage(classes: HomeroomClass[]): ReminderText | null {
  if (classes.length === 0) return null;

  const lines = classes.map((room) => {
    const days = room.missingDays ?? [];
    const when = days.length > 0 ? ` (${days.map(shortDate).join(', ')})` : '';
    return `• ${room.classroomName}${when}`;
  });

  return {
    titleLo: 'ຍັງບໍ່ໄດ້ຢືນຢັນການຕິດຕາມ',
    bodyLo: [...lines, '', 'ກະລຸນາຢືນຢັນກ່ອນທ່ຽງຂອງມື້ນີ້'].join('\n'),
  };
}

/** One room on the office's weekly digest. */
export interface HomeroomDigestRoom {
  classroomName: string;
  teacherName: string | null;
  missing: number;
}

/**
 * The office's week: which rooms went unreviewed.
 *
 * One message rather than a screen to remember to open, and deliberately short —
 * the report itself is on the screen, and what this has to carry is the reason to
 * go and read it. Returns `null` for a week nobody was behind, because a digest
 * that arrives every Friday saying "all well" is the next thing to be filtered.
 */
export function homeroomReviewDigestMessage(input: {
  rooms: HomeroomDigestRoom[];
  due: number;
  confirmed: number;
  late: number;
}): ReminderText | null {
  const behind = input.rooms.filter((room) => room.missing > 0);
  if (behind.length === 0) return null;

  const lines = behind
    .slice(0, 10)
    .map(
      (room) =>
        `• ${room.classroomName} — ${room.teacherName ?? 'ຍັງບໍ່ມີຄູປະຈຳຫ້ອງ'} (ຂາດ ${room.missing})`,
    );
  if (behind.length > 10) lines.push(`• ແລະ ອີກ ${behind.length - 10} ຫ້ອງ`);

  return {
    titleLo: 'ສະຫຼຸບການຕິດຕາມຂອງຄູປະຈຳຫ້ອງ',
    bodyLo: [
      `ຕ້ອງຕິດຕາມ ${input.due} ຄັ້ງ — ຢືນຢັນແລ້ວ ${input.confirmed}, ຊ້າ ${input.late}`,
      '',
      ...lines,
    ].join('\n'),
  };
}
