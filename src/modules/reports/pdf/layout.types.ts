import { Locale } from 'src/common/i18n/messages';

/**
 * The layout language stored in `reportTemplates.layout`.
 *
 * Deliberately a small, closed set of section types rather than a general
 * templating language: an admin composes a report by ordering sections and
 * setting labels, and every section maps to a renderer that knows how to draw
 * real data. A free-form template engine would move layout bugs from build time
 * to report-generation time, which is exactly where they are hardest to see.
 *
 * Unknown section types are skipped with a warning rather than throwing, so a
 * template authored against a newer version still produces a usable document.
 */
export interface ReportLayout {
  pageSize?: 'A4' | 'LETTER';
  orientation?: 'portrait' | 'landscape';
  margins?: { top: number; bottom: number; left: number; right: number };
  /** Which language the labels are drawn in. Data is always Lao. */
  locale?: Locale;
  header?: ReportHeader;
  sections: ReportSection[];
  footer?: { textLo?: string; textEn?: string; showPageNumbers?: boolean };
}

export interface ReportHeader {
  /** Overrides the `school.nameLo` setting when set. */
  schoolNameLo?: string;
  titleLo: string;
  titleEn?: string;
  subtitleLo?: string;
  /** Ministry line above the school name, as Lao official documents carry. */
  authorityLo?: string;
}

export type ReportSection =
  | StudentInfoSection
  | SubjectsTableSection
  | SummarySection
  | AttendanceSection
  | ConductSection
  | TextSection
  | SignaturesSection
  | SpacerSection;

export interface StudentInfoSection {
  type: 'studentInfo';
  /** Which student fields to print, in order. */
  fields?: StudentInfoField[];
  /** Two columns fit an A4 report card; one column reads better on a transcript. */
  columns?: 1 | 2;
}

export type StudentInfoField =
  | 'studentCode'
  | 'fullName'
  | 'gender'
  | 'dateOfBirth'
  | 'classroom'
  | 'gradeLevel'
  | 'schoolYear'
  | 'semester'
  | 'guardian'
  | 'village';

export interface SubjectsTableSection {
  type: 'subjectsTable';
  /** Include the per-component breakdown under each subject. */
  showComponents?: boolean;
  showCredits?: boolean;
  showGradePoint?: boolean;
  labelLo?: string;
}

export interface SummarySection {
  type: 'summary';
  showAverage?: boolean;
  showGpa?: boolean;
  showRank?: boolean;
  showPassFail?: boolean;
  labelLo?: string;
}

export interface AttendanceSection {
  type: 'attendance';
  labelLo?: string;
}

export interface ConductSection {
  type: 'conduct';
  labelLo?: string;
}

export interface TextSection {
  type: 'text';
  contentLo: string;
  contentEn?: string;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  bold?: boolean;
}

export interface SignaturesSection {
  type: 'signatures';
  /** e.g. `['ຄູປະຈຳຫ້ອງ', 'ຜູ້ອຳນວຍການ', 'ຜູ້ປົກຄອງ']`. */
  rolesLo: string[];
  showDate?: boolean;
}

export interface SpacerSection {
  type: 'spacer';
  height: number;
}

/** A sensible report card, used as the seeded default template. */
export const DEFAULT_REPORT_CARD_LAYOUT: ReportLayout = {
  pageSize: 'A4',
  orientation: 'portrait',
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  locale: 'lo',
  header: {
    authorityLo: 'ກະຊວງສຶກສາທິການ ແລະ ກີລາ',
    titleLo: 'ໃບລາຍງານຜົນການຮຽນ',
    titleEn: 'Academic Report Card',
  },
  sections: [
    {
      type: 'studentInfo',
      columns: 2,
      fields: [
        'studentCode',
        'fullName',
        'gender',
        'dateOfBirth',
        'classroom',
        'schoolYear',
        'semester',
        'guardian',
      ],
    },
    { type: 'spacer', height: 12 },
    { type: 'subjectsTable', showComponents: false, showCredits: true, showGradePoint: true },
    { type: 'spacer', height: 12 },
    { type: 'summary', showAverage: true, showGpa: true, showRank: true, showPassFail: true },
    { type: 'attendance' },
    { type: 'conduct' },
    { type: 'spacer', height: 24 },
    {
      type: 'signatures',
      rolesLo: ['ຄູປະຈຳຫ້ອງ', 'ຜູ້ອຳນວຍການ', 'ຜູ້ປົກຄອງ'],
      showDate: true,
    },
  ],
  footer: { showPageNumbers: true },
};

/** Certificate layout — one page, centred, no tables. */
export const DEFAULT_CERTIFICATE_LAYOUT: ReportLayout = {
  pageSize: 'A4',
  orientation: 'landscape',
  margins: { top: 60, bottom: 60, left: 70, right: 70 },
  locale: 'lo',
  header: {
    authorityLo: 'ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ',
    titleLo: 'ໃບປະກາດສະນີຍະບັດ',
    titleEn: 'Certificate',
  },
  sections: [
    { type: 'spacer', height: 20 },
    {
      type: 'text',
      contentLo: 'ມອບໃຫ້ແກ່',
      align: 'center',
      fontSize: 14,
    },
    { type: 'studentInfo', columns: 1, fields: ['fullName', 'studentCode', 'gradeLevel'] },
    { type: 'spacer', height: 20 },
    { type: 'summary', showAverage: true, showGpa: false, showRank: false, showPassFail: true },
    { type: 'spacer', height: 30 },
    { type: 'signatures', rolesLo: ['ຜູ້ອຳນວຍການ'], showDate: true },
  ],
};
