import { CalendarEventType, SchoolDayEffect } from 'src/common/constants/enums';

/**
 * `SCHOOL CALENDAR 2026–2027 — SECONDARY`, as the school printed it.
 *
 * Transcribed from the sheet on the office wall, from the dated list along its
 * foot rather than from the colour grid: the list names all twenty-five entries
 * and the grid adds only weekends, which are a rule and not data. The colours are
 * the sheet's legend, and `type` is that legend one-for-one — see
 * `CALENDAR_EVENT_TYPES`.
 *
 * `dayEffect` is the part that is not printed and had to be decided, because the
 * sheet marks 6 and 7 October both `Teacher's Day` and only says `Holiday for`
 * against the second. The rule the office gave:
 *
 * - `Holiday for …` / `Holiday in lieu of …` and the two festival stretches shut
 *   the school — `closed`.
 * - `… celebrated at School` is a normal day with a party in it — `open`. The roll
 *   call is owed.
 * - `Teacher's PD — no school for students` and **every exam period** suspend the
 *   timetable — `no_classes`. Nothing is owed, and no teacher is behind for it.
 *
 * Two entries on the sheet are deliberately not here:
 *
 * - `6 Feb — Chinese New Year celebrated at School`, because 6 February 2027 is a
 *   Saturday. Either the date or the day is wrong on the paper and the office has
 *   not yet said which. It changes nothing that is computed — the day is a weekend
 *   either way — so it is left for them to file.
 * - the summer break, because it falls outside 17 Aug – 10 Jun and every report is
 *   already bounded by the school year.
 *
 * The Lao titles are a translation of the English on the sheet, which prints only
 * English. They are what the calendar screen shows a Lao-reading teacher, so they
 * are the office's to correct.
 */
export interface SchoolCalendarEntry {
  titleLo: string;
  titleEn: string;
  type: CalendarEventType;
  dayEffect: SchoolDayEffect;
  /** `yyyy-MM-dd`. */
  startDate: string;
  /** Inclusive; equal to `startDate` for a one-day entry. */
  endDate: string;
  isHalfDay?: boolean;
}

export const SCHOOL_CALENDAR_2026_2027: SchoolCalendarEntry[] = [
  // ── ພາກຮຽນທີ 1 ────────────────────────────────────────────────────────────
  {
    titleLo: 'ວັນເປີດສົກຮຽນ',
    titleEn: 'First Day of School',
    type: 'first_day',
    dayEffect: 'open',
    startDate: '2026-08-17',
    endDate: '2026-08-17',
  },
  {
    titleLo: 'ງານເປີດບ້ານ (Open House)',
    titleEn: 'Open House',
    type: 'open_house',
    dayEffect: 'open',
    startDate: '2026-09-04',
    endDate: '2026-09-04',
  },
  {
    titleLo: 'ຝຶກອົບຮົມຄູ (ນັກຮຽນພັກ)',
    titleEn: "Teacher's PD — no school for students",
    type: 'professional_development',
    dayEffect: 'no_classes',
    startDate: '2026-09-21',
    endDate: '2026-09-21',
  },
  {
    titleLo: 'ງານວັນຄູແຫ່ງຊາດ (ຈັດຢູ່ໂຮງຮຽນ)',
    titleEn: "Teacher's Day celebrated at School",
    type: 'celebration',
    dayEffect: 'open',
    startDate: '2026-10-06',
    endDate: '2026-10-06',
  },
  {
    titleLo: 'ພັກວັນຄູແຫ່ງຊາດ',
    titleEn: "Holiday for Teachers' Day",
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-10-07',
    endDate: '2026-10-07',
  },
  {
    titleLo: 'ງານວັນສະຫະປະຊາຊາດ (ຈັດຢູ່ໂຮງຮຽນ)',
    titleEn: 'UN Day celebrated at school',
    type: 'celebration',
    dayEffect: 'open',
    startDate: '2026-10-23',
    endDate: '2026-10-23',
  },
  {
    titleLo: 'ບຸນອອກພັນສາ ແລະ ບຸນຊ່ວງເຮືອ',
    titleEn: 'End of Buddhist Lent & Boat Race Festival',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-10-26',
    endDate: '2026-10-27',
  },
  {
    titleLo: 'ບຸນທາດຫຼວງ (ວັນຕັກບາດ)',
    titleEn: 'That Luang Festival Alms Giving Day',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-11-24',
    endDate: '2026-11-24',
  },
  {
    titleLo: 'ພັກວັນຊາດລາວ',
    titleEn: 'Holiday for Lao Independence Day',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-12-02',
    endDate: '2026-12-02',
  },
  {
    titleLo: 'ສອບເສັງກາງພາກ (ພາຍໃນ)',
    titleEn: 'Internal Midterm Exams',
    type: 'exam',
    dayEffect: 'no_classes',
    startDate: '2026-12-08',
    endDate: '2026-12-15',
  },
  {
    titleLo: 'ງານບຸນຄຣິດສະມາດ (ຈັດຢູ່ໂຮງຮຽນ)',
    titleEn: 'Christmas celebrated at School',
    type: 'celebration',
    dayEffect: 'open',
    startDate: '2026-12-16',
    endDate: '2026-12-16',
  },
  {
    titleLo: 'ພັກບຸນຄຣິດສະມາດ ແລະ ປີໃໝ່ສາກົນ',
    titleEn: 'Christmas / New Year Holiday',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2026-12-17',
    endDate: '2027-01-05',
  },

  // ── ພາກຮຽນທີ 2 ────────────────────────────────────────────────────────────
  {
    titleLo: 'ແຈກໃບຄະແນນ',
    titleEn: 'Report Card Distribution',
    type: 'report_card',
    dayEffect: 'open',
    startDate: '2027-02-01',
    endDate: '2027-02-01',
  },
  {
    titleLo: 'ງານວັນວາເລນທາຍ (ຈັດຢູ່ໂຮງຮຽນ)',
    titleEn: "Valentine's Day celebrated at school",
    type: 'celebration',
    dayEffect: 'open',
    startDate: '2027-02-12',
    endDate: '2027-02-12',
  },
  {
    titleLo: 'ຝຶກອົບຮົມຄູ (ນັກຮຽນພັກ)',
    titleEn: "Teacher's PD — no school for students",
    type: 'professional_development',
    dayEffect: 'no_classes',
    startDate: '2027-02-19',
    endDate: '2027-02-19',
  },
  {
    titleLo: 'ພັກຊົດເຊີຍວັນແມ່ຍິງສາກົນ',
    titleEn: "Holiday in lieu of Women's Day",
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2027-03-08',
    endDate: '2027-03-08',
  },
  {
    titleLo: 'ສອບເສັງລອງ (Mock)',
    titleEn: 'Mock exams',
    type: 'exam',
    dayEffect: 'no_classes',
    startDate: '2027-04-01',
    endDate: '2027-04-08',
  },
  {
    titleLo: 'ງານບຸນປີໃໝ່ລາວ (ຈັດຢູ່ໂຮງຮຽນ)',
    titleEn: 'Pi Mai celebrated at School',
    type: 'celebration',
    dayEffect: 'open',
    startDate: '2027-04-09',
    endDate: '2027-04-09',
  },
  {
    titleLo: 'ພັກບຸນປີໃໝ່ລາວ',
    titleEn: 'Pi Mai Holiday',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2027-04-12',
    endDate: '2027-04-19',
  },
  {
    titleLo: 'ພັກຊົດເຊີຍວັນກຳມະກອນສາກົນ',
    titleEn: 'Holiday in lieu of Labour Day',
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2027-05-03',
    endDate: '2027-05-03',
  },
  {
    titleLo: 'ສອບເສັງພາຍໃນ ປະຈຳສົກຮຽນ',
    titleEn: 'Internal Exams',
    type: 'exam',
    dayEffect: 'no_classes',
    startDate: '2027-05-10',
    endDate: '2027-05-14',
  },
  {
    // The sheet's legend marks these `* = exact dates TBA`, so the office may
    // still move them; they are filed on the printed dates until it does.
    titleLo: 'ສອບເສັງລະດັບຊາດ (ກະຊວງສຶກສາ)',
    titleEn: 'Lao Exams',
    type: 'lao_exam',
    dayEffect: 'no_classes',
    startDate: '2027-05-17',
    endDate: '2027-05-19',
  },
  {
    titleLo: 'ພັກວັນເດັກນ້ອຍສາກົນ',
    titleEn: "Holiday for Children's Day",
    type: 'holiday',
    dayEffect: 'closed',
    startDate: '2027-06-01',
    endDate: '2027-06-01',
  },
  {
    titleLo: 'ແຈກໃບຄະແນນ',
    titleEn: 'Report Card Distribution',
    type: 'report_card',
    dayEffect: 'open',
    startDate: '2027-06-07',
    endDate: '2027-06-07',
  },
  {
    titleLo: 'ວັນຮຽນສຸດທ້າຍ (ຄຶ່ງວັນ) ແລະ ງານປິດສົກຮຽນ',
    titleEn: 'Last Day of School (half day) and Year End Program',
    type: 'year_end_program',
    dayEffect: 'open',
    startDate: '2027-06-10',
    endDate: '2027-06-10',
    isHalfDay: true,
  },
];
