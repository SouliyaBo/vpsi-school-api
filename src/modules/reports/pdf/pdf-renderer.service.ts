import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Locale } from 'src/common/i18n/messages';
import { resolveLaoFonts } from './font-resolver';
import { ReportLayout, ReportSection, StudentInfoField, StudentInfoSection } from './layout.types';

/** Everything a report can draw. Assembled by ReportDataService. */
export interface ReportData {
  schoolNameLo: string;
  student: {
    studentCode: string;
    fullNameLo: string;
    genderLo: string;
    dateOfBirth: Date | null;
    villageLo: string | null;
    guardianLo: string | null;
  };
  academic: {
    classroomName: string;
    gradeLevelLo: string;
    schoolYearCode: string;
    semesterLo: string;
  };
  /**
   * What the marks on this report are out of.
   *
   * Stored marks are always a percentage, because that is what ranks a class and
   * averages across subjects. Schools that mark out of 10 — this one keeps a
   * 10-point monthly sheet — read `8.31`, not `83.10%`, so the figure is scaled
   * and the column relabelled at the last moment rather than stored twice.
   */
  markScale?: number;
  subjects: {
    nameLo: string;
    credits: number;
    percentage: number;
    grade: string;
    gradePoint: number;
    isPassed: boolean;
    components: { nameLo: string; score: number | null; maxScore: number; weight: number }[];
  }[];
  summary: {
    average: number;
    gpa: number;
    grade: string;
    rank: number | null;
    totalStudents: number | null;
    subjectsPassed: number;
    subjectsFailed: number;
    isProvisional: boolean;
  };
  attendance: { present: number; absent: number; late: number; excused: number };
  conductGradeLo: string | null;
  /** Certificate-only fields. */
  certificate?: { number: string; issuedDate: Date; titleLo: string | null };
}

// ── Font registration names ─────────────────────────────────────────────────

const LAO = 'lao';
const LAO_BOLD = 'lao-bold';
/**
 * PDFKit built-ins, used for digits and Latin.
 *
 * Noto Sans Lao contains **only** Lao — 116 glyphs, no digits, no letters, not
 * even a period. Drawing a whole report card with it silently drops every
 * number, code and date. Helvetica is always available and needs no file, so
 * pairing the two costs nothing and covers everything a report contains.
 */
const LATIN = 'Helvetica';
const LATIN_BOLD = 'Helvetica-Bold';

/** Lao block, including the Lao digits. */
const LAO_PATTERN = /[຀-໿]/;

/** Column widths for the subjects table, as fractions of the content width. */
const SUBJECT_COLUMNS = {
  name: 0.4,
  credits: 0.1,
  percentage: 0.15,
  grade: 0.12,
  gradePoint: 0.13,
  result: 0.1,
} as const;

/**
 * A stored percentage as the school reads it.
 *
 * Marks are stored out of 100 so a class can be ranked and a GPA taken across
 * subjects marked in different ways; a school on a 10-point sheet prints 8.31.
 */
export function toMarkScale(percentage: number, data: { markScale?: number }): number {
  const scale = data.markScale ?? 100;
  return scale === 100 ? percentage : Math.round(((percentage * scale) / 100) * 100) / 100;
}

/** `ຄະແນນ (%)` at full scale, `ຄະແນນ (10)` on a 10-point sheet. */
export function markLabel(data: { markScale?: number }, locale: 'lo' | 'en'): string {
  const scale = data.markScale ?? 100;
  if (scale === 100) return LABELS.percentage[locale];
  return `${LABELS.markOutOf[locale]} (${scale})`;
}

const LABELS: Record<string, { lo: string; en: string }> = {
  studentCode: { lo: 'ລະຫັດນັກຮຽນ', en: 'Student code' },
  fullName: { lo: 'ຊື່ ແລະ ນາມສະກຸນ', en: 'Full name' },
  gender: { lo: 'ເພດ', en: 'Gender' },
  dateOfBirth: { lo: 'ວັນເດືອນປີເກີດ', en: 'Date of birth' },
  classroom: { lo: 'ຫ້ອງຮຽນ', en: 'Classroom' },
  gradeLevel: { lo: 'ຊັ້ນຮຽນ', en: 'Grade level' },
  schoolYear: { lo: 'ສົກຮຽນ', en: 'School year' },
  semester: { lo: 'ພາກຮຽນ', en: 'Semester' },
  guardian: { lo: 'ຜູ້ປົກຄອງ', en: 'Guardian' },
  village: { lo: 'ບ້ານ', en: 'Village' },
  subject: { lo: 'ວິຊາ', en: 'Subject' },
  credits: { lo: 'ໜ່ວຍກິດ', en: 'Credits' },
  percentage: { lo: 'ຄະແນນ (%)', en: 'Score (%)' },
  markOutOf: { lo: 'ຄະແນນ', en: 'Score' },
  grade: { lo: 'ເກຣດ', en: 'Grade' },
  gradePoint: { lo: 'ແນນ', en: 'Point' },
  result: { lo: 'ຜົນ', en: 'Result' },
  passed: { lo: 'ຜ່ານ', en: 'Pass' },
  failed: { lo: 'ຕົກ', en: 'Fail' },
  average: { lo: 'ຄະແນນສະເລ່ຍ', en: 'Average' },
  gpa: { lo: 'GPA', en: 'GPA' },
  rank: { lo: 'ອັນດັບໃນຫ້ອງ', en: 'Class rank' },
  subjectsPassed: { lo: 'ວິຊາທີ່ຜ່ານ', en: 'Subjects passed' },
  subjectsFailed: { lo: 'ວິຊາທີ່ຕົກ', en: 'Subjects failed' },
  attendance: { lo: 'ການເຂົ້າຮຽນ', en: 'Attendance' },
  present: { lo: 'ມາຮຽນ', en: 'Present' },
  absent: { lo: 'ຂາດ', en: 'Absent' },
  late: { lo: 'ມາຊ້າ', en: 'Late' },
  excused: { lo: 'ລາ', en: 'Excused' },
  conduct: { lo: 'ຄະແນນຄວາມປະພຶດ', en: 'Conduct' },
  provisional: { lo: '(ຜົນຊົ່ວຄາວ — ຍັງບໍ່ຄົບຖ້ວນ)', en: '(Provisional — incomplete)' },
  date: { lo: 'ວັນທີ', en: 'Date' },
  certificateNumber: { lo: 'ເລກທີ', en: 'No.' },
};

const CONDUCT_LABELS: Record<string, string> = {
  excellent: 'ດີເລີດ',
  very_good: 'ດີຫຼາຍ',
  good: 'ດີ',
  fair: 'ພໍໃຊ້',
  poor: 'ຕ້ອງປັບປຸງ',
};

export const GENDER_LABELS: Record<string, string> = {
  male: 'ຊາຍ',
  female: 'ຍິງ',
  other: 'ອື່ນໆ',
};

export { CONDUCT_LABELS };

interface TextRun {
  text: string;
  isLao: boolean;
}

/**
 * Splits a string into consecutive same-script runs.
 *
 * Whitespace and punctuation are treated as neutral and stay with the run in
 * progress, so `"ບຸນມີ ສີສຸວັນ (02055500001)"` becomes two runs rather than six.
 */
export function segmentByScript(text: string): TextRun[] {
  if (text.length === 0) return [];

  const runs: TextRun[] = [];
  let current = '';
  let currentIsLao = LAO_PATTERN.test(text[0]);

  for (const char of text) {
    const isNeutral = /[\s\d\p{P}]/u.test(char) && !LAO_PATTERN.test(char);
    const isLao = LAO_PATTERN.test(char);

    // Digits and punctuation have no glyphs in the Lao font, so a neutral
    // character can only stay in a Lao run if it is whitespace.
    const belongsHere = isNeutral ? /\s/.test(char) || !currentIsLao : isLao === currentIsLao;

    if (belongsHere || current === '') {
      current += char;
      if (current === char) currentIsLao = isNeutral ? currentIsLao : isLao;
    } else {
      runs.push({ text: current, isLao: currentIsLao });
      current = char;
      currentIsLao = isLao;
    }
  }

  if (current) runs.push({ text: current, isLao: currentIsLao });
  return runs;
}

/**
 * Renders a report to a PDF buffer.
 *
 * Buffers rather than streams to storage directly: a report is at most a few
 * hundred kilobytes, and having the whole document in hand means a rendering
 * failure produces no object at all instead of a truncated one that looks valid.
 */
@Injectable()
export class PdfRendererService {
  private readonly logger = new Logger(PdfRendererService.name);

  async render(layout: ReportLayout, data: ReportData): Promise<Buffer> {
    // Throws LaoFontUnavailableError, which the queue processor records as the
    // job's failure reason — better than a PDF full of blank boxes.
    const fonts = resolveLaoFonts();
    const locale: Locale = layout.locale ?? 'lo';

    const doc = new PDFDocument({
      size: layout.pageSize ?? 'A4',
      layout: layout.orientation ?? 'portrait',
      margins: layout.margins ?? { top: 50, bottom: 50, left: 50, right: 50 },
      bufferPages: true,
      info: { Title: layout.header?.titleLo ?? 'Report', Creator: 'VPSI School Management' },
    });

    doc.registerFont(LAO, fonts.regular);
    doc.registerFont(LAO_BOLD, fonts.bold);
    doc.font(LATIN);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', reject);
    });

    this.drawHeader(doc, layout, data, locale);
    for (const section of layout.sections) {
      this.drawSection(doc, section, data, locale);
    }
    this.drawFooter(doc, layout, locale);

    doc.end();
    await finished;

    return Buffer.concat(chunks);
  }

  // ── Mixed-script text ─────────────────────────────────────────────────────

  /** The registered font name for a run. */
  private fontFor(isLao: boolean, bold: boolean): string {
    if (isLao) return bold ? LAO_BOLD : LAO;
    return bold ? LATIN_BOLD : LATIN;
  }

  /**
   * Line height for a mixed line, always taken from the Lao face.
   *
   * Lao stacks vowels above and tone marks above those, so it needs noticeably
   * more leading than Latin. Using whichever font happened to be active gives
   * Helvetica's tighter metrics and the marks of one line collide with the line
   * above.
   */
  private lineHeight(doc: PDFKit.PDFDocument): number {
    // `_font` is PDFKit's internal current-font handle; there is no public
    // accessor, and every run re-selects its own font immediately afterwards,
    // so nothing depends on what is restored here.
    const previous = (doc as unknown as { _font?: { name?: string } })._font;
    doc.font(LAO);
    const height = doc.currentLineHeight(true);
    if (previous?.name) doc.font(previous.name);
    return height;
  }

  /** Width of a string under the font its script requires. */
  private measure(doc: PDFKit.PDFDocument, runs: TextRun[], bold: boolean): number {
    return runs.reduce((total, run) => {
      doc.font(this.fontFor(run.isLao, bold));
      return total + doc.widthOfString(run.text);
    }, 0);
  }

  /**
   * Draws one line of possibly mixed-script text.
   *
   * Runs are measured and placed at explicit coordinates on a **shared
   * alphabetic baseline** rather than chained with PDFKit's `continued` option.
   * Chaining looked simpler but broke in two visible ways: Lao and Latin faces
   * have different ascents, so continued runs sat at different heights; and
   * PDFKit aligns each continued chunk independently, so a right-aligned mixed
   * string came apart across two lines.
   *
   * Returns the y coordinate below the line.
   */
  private writeLine(
    doc: PDFKit.PDFDocument,
    text: string,
    options: {
      x: number;
      y: number;
      width: number;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
    },
  ): number {
    const runs = segmentByScript(text);
    const bold = options.bold ?? false;
    if (runs.length === 0) return options.y;

    const totalWidth = this.measure(doc, runs, bold);
    const lineHeight = this.lineHeight(doc);

    // Everything shares one baseline, so the two faces line up regardless of
    // their differing ascents.
    const baselineY = options.y + lineHeight * 0.72;

    let cursorX = options.x;
    if (options.align === 'center') {
      cursorX = options.x + Math.max(0, (options.width - totalWidth) / 2);
    } else if (options.align === 'right') {
      cursorX = options.x + Math.max(0, options.width - totalWidth);
    }

    for (const run of runs) {
      doc.font(this.fontFor(run.isLao, bold));
      doc.text(run.text, cursorX, baselineY, { lineBreak: false, baseline: 'alphabetic' });
      cursorX += doc.widthOfString(run.text);
    }

    const bottom = options.y + lineHeight;
    doc.y = bottom;
    this.resetX(doc);
    return bottom;
  }

  /**
   * Draws mixed-script text that may wrap over several lines.
   *
   * Used only for free-form paragraphs, where wrapping matters more than exact
   * cross-script baseline alignment. Single-line content should use
   * `writeLine`.
   */
  private writeParagraph(
    doc: PDFKit.PDFDocument,
    text: string,
    options: {
      x: number;
      y: number;
      width: number;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
    },
  ): void {
    const runs = segmentByScript(text);
    const bold = options.bold ?? false;
    if (runs.length === 0) return;

    // A single-script paragraph needs no chaining, which keeps the common case
    // free of the alignment quirks that come with `continued`.
    if (runs.length === 1) {
      doc.font(this.fontFor(runs[0].isLao, bold));
      doc.text(runs[0].text, options.x, options.y, {
        width: options.width,
        align: options.align ?? 'left',
      });
      this.resetX(doc);
      return;
    }

    runs.forEach((run, index) => {
      doc.font(this.fontFor(run.isLao, bold));
      const isLast = index === runs.length - 1;
      const textOptions = { width: options.width, continued: !isLast };

      if (index === 0) doc.text(run.text, options.x, options.y, textOptions);
      else doc.text(run.text, textOptions);
    });

    this.resetX(doc);
  }

  // ── Header / footer ───────────────────────────────────────────────────────

  private drawHeader(
    doc: PDFKit.PDFDocument,
    layout: ReportLayout,
    data: ReportData,
    locale: Locale,
  ): void {
    const header = layout.header;
    if (!header) return;

    const width = this.contentWidth(doc);

    const left = doc.page.margins.left;
    const centred = { x: left, width, align: 'center' as const };

    if (header.authorityLo) {
      doc.fontSize(10);
      this.writeLine(doc, header.authorityLo, { ...centred, y: doc.y });
    }

    doc.fontSize(13);
    this.writeLine(doc, header.schoolNameLo ?? data.schoolNameLo, {
      ...centred,
      y: doc.y,
      bold: true,
    });

    doc.moveDown(0.4);
    doc.fontSize(17);
    this.writeLine(doc, header.titleLo, { ...centred, y: doc.y, bold: true });

    if (header.titleEn && locale === 'en') {
      doc.fontSize(11);
      this.writeLine(doc, header.titleEn, { ...centred, y: doc.y });
    }
    if (header.subtitleLo) {
      doc.fontSize(11);
      this.writeLine(doc, header.subtitleLo, { ...centred, y: doc.y });
    }

    if (data.certificate) {
      doc.fontSize(10);
      this.writeLine(doc, `${LABELS.certificateNumber[locale]}: ${data.certificate.number}`, {
        ...centred,
        y: doc.y,
      });
    }

    // A provisional result must be unmistakable on paper — someone will file it.
    if (data.summary.isProvisional) {
      doc.moveDown(0.3).fontSize(10).fillColor('#b00020');
      this.writeLine(doc, LABELS.provisional[locale], { ...centred, y: doc.y, bold: true });
      doc.fillColor('black');
    }

    doc.moveDown(0.8);
    this.drawRule(doc);
    doc.moveDown(0.6);
  }

  private drawFooter(doc: PDFKit.PDFDocument, layout: ReportLayout, locale: Locale): void {
    const footer = layout.footer;
    if (!footer) return;

    const text = locale === 'en' ? (footer.textEn ?? footer.textLo) : footer.textLo;
    const range = doc.bufferedPageRange();

    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      const y = doc.page.height - doc.page.margins.bottom + 12;

      if (text) {
        doc.fontSize(8);
        this.writeLine(doc, text, {
          x: doc.page.margins.left,
          y,
          width: this.contentWidth(doc),
          align: 'left',
        });
      }
      if (footer.showPageNumbers) {
        // Pure ASCII, so the Latin font is enough and cheaper than segmenting.
        doc
          .font(LATIN)
          .fontSize(8)
          .text(`${index + 1} / ${range.count}`, doc.page.margins.left, y, {
            width: this.contentWidth(doc),
            align: 'right',
          });
      }
    }
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  private drawSection(
    doc: PDFKit.PDFDocument,
    section: ReportSection,
    data: ReportData,
    locale: Locale,
  ): void {
    // Every section starts at the left margin regardless of what the previous one
    // left behind, so a column layout cannot leak into the next section's width.
    this.resetX(doc);

    switch (section.type) {
      case 'studentInfo':
        return this.drawStudentInfo(doc, section, data, locale);
      case 'subjectsTable':
        return this.drawSubjectsTable(doc, section, data, locale);
      case 'summary':
        return this.drawSummary(doc, section, data, locale);
      case 'attendance':
        return this.drawAttendance(doc, section, data, locale);
      case 'conduct':
        return this.drawConduct(doc, section, data, locale);
      case 'text':
        return this.drawText(doc, section, locale);
      case 'signatures':
        return this.drawSignatures(doc, section, locale);
      case 'spacer':
        doc.moveDown(section.height / 12);
        return;
      default: {
        // Forward compatibility: a template written for a newer version still
        // renders, minus the section this build does not know.
        const unknown = section as { type?: string };
        this.logger.warn(`Skipping unknown report section type: ${String(unknown.type)}`);
      }
    }
  }

  private drawStudentInfo(
    doc: PDFKit.PDFDocument,
    section: StudentInfoSection,
    data: ReportData,
    locale: Locale,
  ): void {
    const fields = section.fields ?? ['studentCode', 'fullName', 'classroom', 'schoolYear'];
    const columns = section.columns ?? 2;
    const width = this.contentWidth(doc);
    const columnWidth = width / columns;

    let column = 0;
    let rowTop = doc.y;

    for (const field of fields) {
      const value = this.studentFieldValue(field, data);
      if (value === null) continue;

      const x = doc.page.margins.left + column * columnWidth;

      // The name is the point of a certificate — give it prominence.
      if (columns === 1 && field === 'fullName') {
        doc.fontSize(20);
        this.writeLine(doc, value, {
          bold: true,
          x: doc.page.margins.left,
          y: doc.y,
          width,
          align: 'center',
        });
        doc.moveDown(0.5);
        rowTop = doc.y;
        continue;
      }

      // Label and value are drawn as one line so the two scripts share a
      // baseline; the value's bold run starts where the label ends.
      doc.fontSize(10);
      const label = `${LABELS[field][locale]}: `;
      const labelWidth = this.measure(doc, segmentByScript(label), false);

      this.writeLine(doc, label, { x, y: rowTop, width: columnWidth - 10 });
      const rowBottom = this.writeLine(doc, value, {
        x: x + labelWidth,
        y: rowTop,
        width: Math.max(10, columnWidth - 10 - labelWidth),
        bold: true,
      });

      column += 1;
      if (column >= columns) {
        column = 0;
        rowTop = rowBottom + 2;
      }
    }

    // If the last row was half-filled, advance past it.
    if (column !== 0) doc.y = rowTop + 14;
    this.resetX(doc);
    doc.moveDown(0.4);
  }

  private studentFieldValue(field: StudentInfoField, data: ReportData): string | null {
    switch (field) {
      case 'studentCode':
        return data.student.studentCode;
      case 'fullName':
        return data.student.fullNameLo;
      case 'gender':
        return data.student.genderLo;
      case 'dateOfBirth':
        return data.student.dateOfBirth ? this.formatDate(data.student.dateOfBirth) : null;
      case 'classroom':
        return data.academic.classroomName;
      case 'gradeLevel':
        return data.academic.gradeLevelLo;
      case 'schoolYear':
        return data.academic.schoolYearCode;
      case 'semester':
        return data.academic.semesterLo;
      case 'guardian':
        return data.student.guardianLo;
      case 'village':
        return data.student.villageLo;
      default:
        return null;
    }
  }

  private drawSubjectsTable(
    doc: PDFKit.PDFDocument,
    section: {
      showComponents?: boolean;
      showCredits?: boolean;
      showGradePoint?: boolean;
      labelLo?: string;
    },
    data: ReportData,
    locale: Locale,
  ): void {
    if (section.labelLo) {
      doc.fontSize(12);
      this.writeLine(doc, section.labelLo, {
        x: doc.page.margins.left,
        y: doc.y,
        width: this.contentWidth(doc),
        bold: true,
      });
      doc.moveDown(0.3);
    }

    const width = this.contentWidth(doc);
    const left = doc.page.margins.left;

    // Redistribute the widths of hidden columns into the subject-name column, so
    // long Lao subject names still fit.
    const visible = {
      credits: section.showCredits !== false,
      gradePoint: section.showGradePoint !== false,
    };
    let nameFraction = SUBJECT_COLUMNS.name;
    if (!visible.credits) nameFraction += SUBJECT_COLUMNS.credits;
    if (!visible.gradePoint) nameFraction += SUBJECT_COLUMNS.gradePoint;

    type Column = {
      key: string;
      label: string;
      fraction: number;
      align: 'left' | 'right' | 'center';
    };

    const columns: Column[] = [
      { key: 'name', label: LABELS.subject[locale], fraction: nameFraction, align: 'left' },
      ...(visible.credits
        ? [
            {
              key: 'credits',
              label: LABELS.credits[locale],
              fraction: SUBJECT_COLUMNS.credits,
              align: 'center' as const,
            },
          ]
        : []),
      {
        key: 'percentage',
        label: markLabel(data, locale),
        fraction: SUBJECT_COLUMNS.percentage,
        align: 'right',
      },
      {
        key: 'grade',
        label: LABELS.grade[locale],
        fraction: SUBJECT_COLUMNS.grade,
        align: 'center',
      },
      ...(visible.gradePoint
        ? [
            {
              key: 'gradePoint',
              label: LABELS.gradePoint[locale],
              fraction: SUBJECT_COLUMNS.gradePoint,
              align: 'center' as const,
            },
          ]
        : []),
      {
        key: 'result',
        label: LABELS.result[locale],
        fraction: SUBJECT_COLUMNS.result,
        align: 'center',
      },
    ];

    // Header row.
    let y = doc.y;
    doc.fontSize(9);
    let x = left;
    let headerBottom = y;
    for (const column of columns) {
      const columnWidth = width * column.fraction;
      const bottom = this.writeLine(doc, column.label, {
        bold: true,
        x,
        y,
        width: columnWidth,
        align: column.align,
      });
      headerBottom = Math.max(headerBottom, bottom);
      x += columnWidth;
    }

    y = headerBottom + 3;
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.7)
      .stroke();
    y += 4;

    doc.fontSize(9);
    for (const subject of data.subjects) {
      // Page break before a row that would not fit, so a subject is never split.
      if (y > doc.page.height - doc.page.margins.bottom - 60) {
        doc.addPage();
        y = doc.y;
      }

      const values: Record<string, string> = {
        name: subject.nameLo,
        credits: String(subject.credits),
        percentage: toMarkScale(subject.percentage, data).toFixed(2),
        grade: subject.grade,
        gradePoint: subject.gradePoint.toFixed(1),
        result: subject.isPassed ? LABELS.passed[locale] : LABELS.failed[locale],
      };

      x = left;
      let rowBottom = y;
      for (const column of columns) {
        const columnWidth = width * column.fraction;
        if (column.key === 'result' && !subject.isPassed) doc.fillColor('#b00020');

        const cellBottom = this.writeLine(doc, values[column.key], {
          x,
          y,
          width: columnWidth,
          align: column.align,
        });

        doc.fillColor('black');
        rowBottom = Math.max(rowBottom, cellBottom);
        x += columnWidth;
      }
      y = rowBottom + 2;

      if (section.showComponents && subject.components.length > 0) {
        doc.fontSize(8).fillColor('#555555');
        for (const component of subject.components) {
          const score = component.score === null ? '—' : component.score.toFixed(2);
          y =
            this.writeLine(
              doc,
              `    · ${component.nameLo}: ${score} / ${component.maxScore}  (${component.weight}%)`,
              { x: left, y, width },
            ) + 1;
        }
        doc.fillColor('black').fontSize(9);
      }
    }

    doc.y = y + 2;
    this.resetX(doc);
    this.drawRule(doc);
    doc.moveDown(0.4);
  }

  private drawSummary(
    doc: PDFKit.PDFDocument,
    section: {
      showAverage?: boolean;
      showGpa?: boolean;
      showRank?: boolean;
      showPassFail?: boolean;
      labelLo?: string;
    },
    data: ReportData,
    locale: Locale,
  ): void {
    if (section.labelLo) {
      doc.fontSize(12);
      this.writeLine(doc, section.labelLo, {
        x: doc.page.margins.left,
        y: doc.y,
        width: this.contentWidth(doc),
        bold: true,
      });
      doc.moveDown(0.2);
    }

    const rows: [string, string][] = [];
    if (section.showAverage !== false) {
      rows.push([
        LABELS.average[locale],
        `${toMarkScale(data.summary.average, data).toFixed(2)}  (${data.summary.grade})`,
      ]);
    }
    if (section.showGpa) rows.push([LABELS.gpa[locale], data.summary.gpa.toFixed(2)]);
    if (section.showRank && data.summary.rank !== null) {
      rows.push([
        LABELS.rank[locale],
        data.summary.totalStudents
          ? `${data.summary.rank} / ${data.summary.totalStudents}`
          : String(data.summary.rank),
      ]);
    }
    if (section.showPassFail) {
      rows.push([LABELS.subjectsPassed[locale], String(data.summary.subjectsPassed)]);
      if (data.summary.subjectsFailed > 0) {
        rows.push([LABELS.subjectsFailed[locale], String(data.summary.subjectsFailed)]);
      }
    }

    this.drawKeyValues(doc, rows);
  }

  private drawAttendance(
    doc: PDFKit.PDFDocument,
    section: { labelLo?: string },
    data: ReportData,
    locale: Locale,
  ): void {
    const { present, absent, late, excused } = data.attendance;
    if (present + absent + late + excused === 0) return;

    doc.fontSize(10);
    this.writeLine(doc, section.labelLo ?? LABELS.attendance[locale], {
      x: doc.page.margins.left,
      y: doc.y,
      width: this.contentWidth(doc),
      bold: true,
    });

    doc.fontSize(9);
    this.writeLine(
      doc,
      `${LABELS.present[locale]}: ${present}    ` +
        `${LABELS.absent[locale]}: ${absent}    ` +
        `${LABELS.late[locale]}: ${late}    ` +
        `${LABELS.excused[locale]}: ${excused}`,
      { x: doc.page.margins.left, y: doc.y, width: this.contentWidth(doc) },
    );

    doc.moveDown(0.3);
  }

  private drawConduct(
    doc: PDFKit.PDFDocument,
    section: { labelLo?: string },
    data: ReportData,
    locale: Locale,
  ): void {
    if (!data.conductGradeLo) return;

    doc.fontSize(10);
    const conductLabel = `${section.labelLo ?? LABELS.conduct[locale]}: `;
    const conductLabelWidth = this.measure(doc, segmentByScript(conductLabel), false);
    const left = doc.page.margins.left;
    const y = doc.y;

    this.writeLine(doc, conductLabel, { x: left, y, width: this.contentWidth(doc) });
    this.writeLine(doc, data.conductGradeLo, {
      x: left + conductLabelWidth,
      y,
      width: this.contentWidth(doc) - conductLabelWidth,
      bold: true,
    });
    doc.moveDown(0.3);
  }

  private drawText(
    doc: PDFKit.PDFDocument,
    section: {
      contentLo: string;
      contentEn?: string;
      align?: 'left' | 'center' | 'right';
      fontSize?: number;
      bold?: boolean;
    },
    locale: Locale,
  ): void {
    const content = locale === 'en' ? (section.contentEn ?? section.contentLo) : section.contentLo;

    doc.fontSize(section.fontSize ?? 11);
    this.writeParagraph(doc, content, {
      x: doc.page.margins.left,
      y: doc.y,
      width: this.contentWidth(doc),
      bold: section.bold,
      align: section.align ?? 'left',
    });
    doc.moveDown(0.4);
  }

  private drawSignatures(
    doc: PDFKit.PDFDocument,
    section: { rolesLo: string[]; showDate?: boolean },
    locale: Locale,
  ): void {
    if (section.showDate) {
      doc.fontSize(9);
      this.writeLine(doc, `${LABELS.date[locale]}: ${this.formatDate(new Date())}`, {
        x: doc.page.margins.left,
        y: doc.y,
        align: 'right',
        width: this.contentWidth(doc),
      });
      doc.moveDown(1.2);
    }

    const width = this.contentWidth(doc);
    const columnWidth = width / section.rolesLo.length;
    const top = doc.y;

    section.rolesLo.forEach((role, index) => {
      const x = doc.page.margins.left + index * columnWidth;
      // Signature rule, then the role beneath it.
      doc
        .moveTo(x + 15, top + 26)
        .lineTo(x + columnWidth - 15, top + 26)
        .lineWidth(0.6)
        .stroke();

      doc.fontSize(9);
      this.writeLine(doc, role, { x, y: top + 32, width: columnWidth, align: 'center' });
    });

    doc.y = top + 52;
    this.resetX(doc);
  }

  // ── Primitives ────────────────────────────────────────────────────────────

  private drawKeyValues(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
    doc.fontSize(10);
    const left = doc.page.margins.left;
    const width = this.contentWidth(doc);

    for (const [label, value] of rows) {
      // Anchored at the left margin with the full content width: a preceding
      // multi-column section otherwise leaves `doc.x` mid-page and every row
      // wraps into a sliver on the right.
      const y = doc.y;
      const labelText = `${label}: `;
      const labelWidth = this.measure(doc, segmentByScript(labelText), false);

      this.writeLine(doc, labelText, { x: left, y, width });
      this.writeLine(doc, value, {
        x: left + labelWidth,
        y,
        width: width - labelWidth,
        bold: true,
      });
    }
    this.resetX(doc);
    doc.moveDown(0.4);
  }

  private drawRule(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(0.7)
      .stroke();
  }

  /**
   * Returns the cursor to the left margin.
   *
   * PDFKit remembers `x` between calls and derives a default text width from it,
   * so any section that draws in columns must put it back or every later section
   * inherits a truncated width.
   */
  private resetX(doc: PDFKit.PDFDocument): void {
    doc.x = doc.page.margins.left;
  }

  private contentWidth(doc: PDFKit.PDFDocument): number {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  /**
   * `dd/MM/yyyy` — the conventional written form in Laos, and unambiguous on a
   * printed document in a way that a locale-dependent format is not.
   */
  private formatDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
  }
}
