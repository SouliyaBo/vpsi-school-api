import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { readFileSync } from 'node:fs';
import { resolveLetterheadImages } from '../reports/pdf/study-certificate-assets';
import type { MonthlyReportView as MonthlyReport } from './homeroom-monthly-report.service';

/**
 * Writes ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ as the office's own form, in Word.
 *
 * Word rather than PDF because the file is not finished when it leaves the
 * system: ສະພາບລວມ, ນັກຮຽນທີ່ຮຽນເພີ່ມ, ການເຄື່ອນໄຫວພາຍນອກ and ຂໍ້ສະເໜີ are things
 * nobody records here, so the teacher types them into the blank rows and lines
 * left for them, then prints and signs. Every table the system could fill is
 * filled; one it had nothing for keeps two empty numbered rows, the way the
 * paper form leaves them.
 *
 * House style: crest beside the title, Phetsarath OT for Lao, Times New Roman for
 * figures, room under ຄູປະຈຳຫ້ອງ to sign.
 */

const LAO_FONT = 'Phetsarath OT';
const LATIN_FONT = 'Times New Roman';
const BODY = 22;
const SMALL = 20;
const LAO_PATTERN = /[຀-໿]/;
/** A4 less 2 cm margins either side, in twips. */
const CONTENT_WIDTH = 11906 - 2 * 1134;
const DOTS = '.'.repeat(150);
const BLANK_ROWS = 2;

type Cell = string | number | null;
interface Column {
  header: string;
  /** Share of the table's width. */
  width: number;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
}

@Injectable()
export class HomeroomMonthlyReportDocxWriter {
  async write(report: MonthlyReport): Promise<Buffer> {
    const document = new Document({
      creator: 'VPSI School Management',
      title: `ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ ${report.classroom.name} ເດືອນ${report.monthNameLo}`,
      styles: { default: { document: { run: { font: LAO_FONT, size: BODY } } } },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 850, bottom: 850, left: 1134, right: 1134 },
            },
          },
          children: this.body(report),
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  private body(report: MonthlyReport): (Paragraph | Table)[] {
    const r = report;
    const nameCol = (width = 0.32): Column => ({ header: 'ຊື່ນັກຮຽນ', width });
    const no: Column = { header: 'ລ/ດ', width: 0.07, align: AlignmentType.CENTER };
    const named = (row: { studentNameLo: string; studentCode: string | null }) =>
      row.studentCode ? `${row.studentNameLo} (${row.studentCode})` : row.studentNameLo;

    const subjectWidth = 0.61 / Math.max(1, r.tests.subjects.length);

    return [
      this.header(r),

      this.heading('I. ສະພາບລວມ.'),
      ...this.written(r.entry.overview, 2),
      this.para(`ຈຳນວນນັກຮຽນທັງໝົດ ${r.overview.students} ຄົນ, ຍິງ ${r.overview.female} ຄົນ`, {
        indent: true,
      }),

      this.heading('II. ການຕິດຕາມນັກຮຽນ'),
      this.heading('1. ການຂາດຮຽນ (ມີເຫດຜົນ ແລະ ບໍ່ມີເຫດຜົນ)', 1),
      this.para('ເອົາຜູ້ທີ່ພົ້ນເດັ່ນໃນເດືອນນັ້ນໆ (ຂາດຮຽນ 3 ມື້ຂຶ້ນໄປ)', {
        indent: true,
        bold: true,
      }),
      this.para(
        `•  ລວມມື້ຂາດ ${r.absence.totalDays} ມື້ (ມີເຫດຜົນ ${r.absence.excusedDays} ມື້, ` +
          `ບໍ່ມີເຫດຜົນ ${r.absence.unexcusedDays} ມື້ — ໃນນັ້ນ ມາຊ້າ 3 ຄັ້ງ = ຂາດ 1 ມື້: ` +
          `${r.absence.lateDays} ມື້)`,
        { indent: true },
      ),
      this.table(
        [
          no,
          nameCol(0.38),
          { header: 'ຈຳນວນມື້ຂາດ', width: 0.15, align: AlignmentType.CENTER },
          { header: 'ເຫດຜົນການຂາດ', width: 0.4 },
        ],
        r.absence.notable.map((row) => [named(row), row.days, row.reasons]),
      ),
      this.para('•  ນັກຮຽນທີ່ເຂົ້າຫ້ອງຊ້າ 3 ຄັ້ງ = ຂາດ 1 ມື້ ມີໃຜແດ່?', { indent: true }),
      this.table(
        [
          no,
          nameCol(0.38),
          { header: 'ຈຳນວນມື້ຂາດ', width: 0.15, align: AlignmentType.CENTER },
          { header: 'ເຫດຜົນການມາຊ້າ', width: 0.4 },
        ],
        r.absence.lates.map((row) => [named(row), row.days, row.reasons]),
      ),

      this.heading('2. ພຶດຕິກຳໃນເວລາຮຽນ (ເອົາຄົນທີ່ພົ້ນເດັ່ນດ້ານລົບ)', 1),
      this.table(
        [no, nameCol(0.38), { header: 'ພຶດຕິກຳ', width: 0.55 }],
        r.behavior.map((row) => [named(row), `${row.behaviors} (${row.entries} ຄັ້ງ)`]),
      ),

      this.heading('3. ນັກຮຽນທີ່ຖືກຕັດຄະແນນ (ພ້ອມບອກຄະແນນທີ່ຖືກຕັດ)', 1),
      this.table(
        [
          no,
          nameCol(0.33),
          { header: 'ຄະແນນທີ່ຖືກຕັດ', width: 0.15, align: AlignmentType.CENTER },
          { header: 'ເຫດຜົນການຖືກຕັດ', width: 0.45 },
        ],
        r.deductions.map((row) => [named(row), row.points, row.reasons]),
      ),

      this.heading(
        '4. ນັກຮຽນທີ່ຖືກປະຕິບັດວິໄນໃນເດືອນນີ້ມີໃຜແດ່? ຖ້າມີແມ່ນໄດ້ຖືກສຳຫຼວດຂັ້ນໃດ ' +
          '(ຄູປະຈຳຫ້ອງ/ວິຊາການ/ອຳນວຍການ)',
        1,
      ),
      this.table(
        [
          no,
          nameCol(0.28),
          { header: 'ສຳຫຼວດຂັ້ນ (ຄູປະຈຳຫ້ອງ/ວິຊາການ/ອຳນວຍການ)', width: 0.25 },
          { header: 'ເຫດຜົນການສຳຫຼວດ', width: 0.4 },
        ],
        r.discipline.map((row) => [named(row), row.handledAt, row.reason]),
      ),

      this.heading('5. ນັກຮຽນທີ່ຮຽນເພີ່ມ', 1),
      this.table(
        [
          no,
          nameCol(0.33),
          { header: 'ວິຊາທີ່ຮຽນ', width: 0.3 },
          { header: 'ອາຈານທີ່ສອນ', width: 0.3 },
        ],
        r.entry.extraClasses.map((row) => [row.studentNameLo ?? '', row.subject, row.teacherName]),
        3,
      ),

      this.heading('6. ຜົນການຮຽນ', 1),
      this.para(
        `6.1. ເສັງຕົວຈິງໄດ້ຄະແນນຫຼຸດຄາດໝາຍ (ບອກຄະແນນທີ່ໄດ້) ມີຈຳນວນ ` +
          `${r.tests.below.length}/${r.tests.tested}`,
        { indent: true, bold: true },
      ),
      this.para(
        `(ຄະແນນກວດກາເດືອນ${r.monthNameLo} ທີ່ຕ່ຳກວ່າ ${r.tests.subjects
          .map((subject) => `${subject.target}/${subject.testMax}`)
          .filter((value, index, all) => all.indexOf(value) === index)
          .join(', ')})`,
        { indent: true, size: SMALL },
      ),
      this.table(
        [
          no,
          nameCol(0.32),
          ...r.tests.subjects.map((subject) => ({
            header: subject.nameLo,
            width: subjectWidth,
            align: AlignmentType.CENTER,
          })),
        ],
        r.tests.below.map((row) => [named(row), ...row.scores]),
      ),

      this.heading('7. ການເຄື່ອນໄຫວພາຍນອກທີ່ພົ້ນເດັ່ນຂອງນັກຮຽນ', 1),
      this.table(
        [
          no,
          nameCol(0.3),
          { header: 'ວ/ດ/ປ ທີ່ເຄື່ອນໄຫວ', width: 0.23, align: AlignmentType.CENTER },
          { header: 'ລາຍລະອຽດ', width: 0.4 },
        ],
        r.entry.outsideActivities.map((row) => [
          row.studentNameLo ?? '',
          row.date ? laoDate(row.date) : null,
          row.detail,
        ]),
        3,
      ),

      this.heading('III. ການພົວພັນຜູ້ປົກຄອງ.'),
      this.table(
        [
          no,
          nameCol(0.28),
          { header: 'ວ.ດ.ປ ທີ່ພົວພັນ', width: 0.17, align: AlignmentType.CENTER },
          { header: 'ເນື້ອໃນການພົວພັນ', width: 0.48 },
        ],
        // The reviews' contacts and the ones the teacher added, in date order.
        [
          ...r.guardianContacts.map((row) => ({ name: named(row), ...row })),
          ...(r.entry.guardianContacts ?? []).map((row) => ({
            name: named({
              studentNameLo: row.studentNameLo ?? '',
              studentCode: row.allStudents
                ? null
                : (r.roster.find((s) => s.studentId === row.studentId)?.studentCode ?? null),
            }),
            ...row,
          })),
        ]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((row) => [row.name, laoDate(row.date), row.content]),
      ),

      this.heading('IV. ຂໍ້ສະເໜີ'),
      ...this.written(r.entry.suggestions, 3),

      this.para(`ທີ່ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ, ວັນທີ ${this.signedOn(r)}`, {
        align: AlignmentType.RIGHT,
        spaceBefore: 240,
      }),
      this.para('ຄູປະຈຳຫ້ອງ', { align: AlignmentType.RIGHT, bold: true, rightIndent: 1300 }),
      new Paragraph({ children: [], spacing: { before: 900 } }),
      this.para(r.classroom.teacherName ?? '.......................................', {
        align: AlignmentType.RIGHT,
        rightIndent: 900,
      }),
    ];
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  /** What the teacher wrote, a paragraph per line — or dotted lines to write on when they wrote nothing. */
  private written(text: string | null, blankLines: number): Paragraph[] {
    const lines = (text ?? '').split('\n').filter((line) => line.trim());
    if (lines.length === 0) {
      return Array.from({ length: blankLines }, () => this.para(DOTS, { indent: true }));
    }
    return lines.map((line) => this.para(line, { indent: true }));
  }

  /** The date it was sent, or blanks for a draft printed to be signed by hand. */
  private signedOn(report: MonthlyReport): string {
    const sent = report.submission.firstSubmittedAt;
    if (!sent) return '......./......./..........';
    // The send instant in Vientiane, as the calendar date the teacher would write.
    const local = new Date(new Date(sent).getTime() + 7 * 60 * 60 * 1000);
    return laoDate(local.toISOString().slice(0, 10));
  }

  /** Crest left, title beside it — one borderless row, as the paper form sets it. */
  private header(report: MonthlyReport): Table {
    const logoPath = resolveLetterheadImages().schoolLogo;
    let logo: ImageRun | null = null;
    if (logoPath) {
      try {
        logo = new ImageRun({
          type: 'png',
          data: readFileSync(logoPath),
          transformation: { width: 72, height: 72 },
        });
      } catch {
        logo = null;
      }
    }

    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const borders = { top: none, bottom: none, left: none, right: none };
    return new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [1500, CONTENT_WIDTH - 1500],
      borders: { ...borders, insideHorizontal: none, insideVertical: none },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders,
              width: { size: 1500, type: WidthType.DXA },
              children: [new Paragraph({ children: logo ? [logo] : [] })],
            }),
            new TableCell({
              borders,
              verticalAlign: VerticalAlign.CENTER,
              width: { size: CONTENT_WIDTH - 1500, type: WidthType.DXA },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: this.runs(
                    `ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ ${report.classroom.name} ເດືອນ${report.monthNameLo}`,
                    { bold: true, size: 30 },
                  ),
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  private heading(text: string, level = 0): Paragraph {
    return new Paragraph({
      spacing: { before: level === 0 ? 200 : 140, after: 60 },
      indent: { left: level * 360 },
      children: this.runs(text, { bold: true }),
    });
  }

  private para(
    text: string,
    options: {
      indent?: boolean;
      bold?: boolean;
      size?: number;
      align?: (typeof AlignmentType)[keyof typeof AlignmentType];
      spaceBefore?: number;
      rightIndent?: number;
    } = {},
  ): Paragraph {
    return new Paragraph({
      alignment: options.align,
      spacing: { before: options.spaceBefore ?? 40, after: 40 },
      indent: {
        left: options.indent ? 360 : 0,
        right: options.rightIndent ?? 0,
      },
      children: this.runs(text, { bold: options.bold, size: options.size }),
    });
  }

  /**
   * A ruled table with ລ/ດ numbered in the first column.
   *
   * `rows` carry every column but ລ/ດ. With nothing to list the table still
   * prints, with `blankRows` empty numbered rows for the teacher to fill.
   */
  private table(columns: Column[], rows: Cell[][], blankRows = BLANK_ROWS): Table {
    const widths = columns.map((column) => Math.round(column.width * CONTENT_WIDTH));
    const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const borders = { top: line, bottom: line, left: line, right: line };

    const cell = (value: Cell, index: number, bold = false, align = columns[index].align) =>
      new TableCell({
        borders,
        verticalAlign: VerticalAlign.CENTER,
        width: { size: widths[index], type: WidthType.DXA },
        margins: { left: 60, right: 60, top: 20, bottom: 20 },
        children: [
          new Paragraph({
            alignment: align,
            children: this.runs(value === null ? '' : String(value), { bold, size: SMALL }),
          }),
        ],
      });

    const body = rows.length > 0 ? rows : Array.from({ length: blankRows }, () => []);
    return new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: widths,
      rows: [
        new TableRow({
          tableHeader: true,
          children: columns.map((column, index) =>
            cell(column.header, index, true, AlignmentType.CENTER),
          ),
        }),
        ...body.map(
          (row, rowIndex) =>
            new TableRow({
              height: { value: 360, rule: 'atLeast' },
              children: columns.map((_, index) =>
                cell(index === 0 ? rowIndex + 1 : (row[index - 1] ?? null), index),
              ),
            }),
        ),
      ],
    });
  }

  /** One run per script, so figures inside Lao text are set in Times as the house style asks. */
  private runs(text: string, style: { bold?: boolean; size?: number } = {}): TextRun[] {
    const runs: TextRun[] = [];
    let current = '';
    let currentIsLao: boolean | null = null;
    const flush = () => {
      if (!current) return;
      runs.push(
        new TextRun({
          text: current,
          font: currentIsLao ? LAO_FONT : LATIN_FONT,
          bold: style.bold,
          size: style.size,
        }),
      );
      current = '';
    };
    for (const character of text) {
      const isLao: boolean = /\s/.test(character)
        ? (currentIsLao ?? true)
        : LAO_PATTERN.test(character);
      if (currentIsLao !== null && isLao !== currentIsLao) flush();
      currentIsLao = isLao;
      current += character;
    }
    flush();
    return runs;
  }
}

/** `2026-10-07` → `07/10/2026`, as the form writes ວ.ດ.ປ. */
export function laoDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}
