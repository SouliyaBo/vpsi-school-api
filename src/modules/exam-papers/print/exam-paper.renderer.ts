import { Injectable, Logger } from '@nestjs/common';
import { ExamOptionLabelStyle } from 'src/common/constants/enums';
import { resolveLetterheadImages } from 'src/modules/reports/pdf/study-certificate-assets';
import { answerFor, seatClass, Variant } from '../variants';
import { IMAGE_TOKEN } from '../docx-exam.parser';
import { isDrawable } from './image-check';
import {
  contentBottom,
  contentWidth,
  openDocument,
  Span,
  spansWithMath,
  Typesetter,
} from './typesetter';

/**
 * Prints the sets, the answer key, and the seat plan.
 *
 * Every set is laid out from the same questions and the variant's index
 * tables; nothing is copied per set, so a corrected stem is corrected in
 * every printout. The layout follows the sample the office gave: number and
 * stem, then the options two to a line when they are short enough, one per
 * line otherwise — with a picture wherever the teacher put one.
 */

export interface PrintImage {
  buffer: Buffer;
  mimeType: string;
  widthPt: number;
  heightPt: number;
  /** Points its bottom sits below the baseline of the text around it. */
  descentPt: number;
}

export interface PrintOption {
  text: string;
  images: PrintImage[];
}

export interface PrintQuestion {
  section: string | null;
  text: string;
  images: PrintImage[];
  options: PrintOption[];
  correctIndex: number | null;
}

export interface PrintPaper {
  title: string;
  schoolNameLo: string;
  preamble: string;
  optionLabelStyle: ExamOptionLabelStyle;
  questions: PrintQuestion[];
  variants: Variant[];
}

export interface SeatPlanStudent {
  rollNumber: number | null;
  studentCode: string;
  studentNameLo: string;
}

export interface SeatPlanData {
  title: string;
  classroomName: string;
  columns: number;
  variants: Variant[];
  students: SeatPlanStudent[];
}

export const OPTION_LETTERS: Record<ExamOptionLabelStyle, string[]> = {
  latin: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  lao: ['ກ', 'ຂ', 'ຄ', 'ງ', 'ຈ', 'ສ', 'ຊ', 'ຍ'],
};

const BODY_SIZE = 11;
const TITLE_SIZE = 14;
/** The stem and options hang from the number. */
const HANG = 20;
/** Air between questions. */
const QUESTION_GAP = 6;
/** Two options share a line when both fit in this share of the measure. */
const TWO_UP_SHARE = 0.48;
/** A picture is never taller than this on a page, whatever Word said. */
const MAX_IMAGE_HEIGHT = 300;
/** Options share a line only when their pictures are small — an equation, not a figure. */
const TWO_UP_IMAGE_HEIGHT = 26;

/**
 * Text with its pictures set in where their `⟦n⟧` tokens stand, and its
 * `$…$` formulas typeset.
 *
 * A token whose picture is missing (deleted on the review page, or one the
 * printer cannot draw) is simply dropped; a picture with no token is not
 * drawn here — `unplaced` says which, and the caller sets those below.
 */
function spansWithImages(
  text: string,
  images: PrintImage[],
  maxWidth: number,
  style: { bold?: boolean } = {},
): { spans: Span[]; unplaced: PrintImage[] } {
  const spans: Span[] = [];
  const placed = new Set<number>();
  let last = 0;
  for (const match of text.matchAll(IMAGE_TOKEN)) {
    const index = Number(match[1]) - 1;
    if (match.index! > last) {
      spans.push(...spansWithMath(text.slice(last, match.index), BODY_SIZE, style));
    }
    const image = images[index];
    if (image && isDrawable(image.buffer, image.mimeType)) {
      const scale = Math.min(1, maxWidth / image.widthPt, MAX_IMAGE_HEIGHT / image.heightPt);
      spans.push({
        text: '',
        image: {
          buffer: image.buffer,
          width: image.widthPt * scale,
          height: image.heightPt * scale,
          descent: image.descentPt * scale,
        },
      });
      placed.add(index);
    }
    last = match.index! + match[0].length;
  }
  if (last < text.length) spans.push(...spansWithMath(text.slice(last), BODY_SIZE, style));
  return { spans, unplaced: images.filter((_, i) => !placed.has(i)) };
}

@Injectable()
export class ExamPaperRenderer {
  private readonly logger = new Logger(ExamPaperRenderer.name);

  /** One PDF holding the requested sets in order, each starting on a fresh page. */
  async renderSets(paper: PrintPaper, labels: string[]): Promise<Buffer> {
    const { doc, finished } = openDocument(paper.title);
    const type = new Typesetter(doc);
    const variants = paper.variants.filter((variant) => labels.includes(variant.label));

    variants.forEach((variant, index) => {
      if (index > 0) doc.addPage();
      const firstPage = doc.bufferedPageRange().count - 1;
      this.drawHeader(doc, type, paper, variant.label);
      this.drawQuestions(doc, type, paper, variant);
      this.drawFooters(doc, type, firstPage, `ຊຸດ ${variant.label}`);
    });

    doc.end();
    return finished;
  }

  /** ໃບເສີຍ — every set's answers side by side, then where each original question went. */
  async renderAnswerKey(paper: PrintPaper): Promise<Buffer> {
    const { doc, finished } = openDocument(`ເສີຍ ${paper.title}`);
    const type = new Typesetter(doc);
    const letters = OPTION_LETTERS[paper.optionLabelStyle];
    const { left } = doc.page.margins;
    const width = contentWidth(doc);

    let y = doc.page.margins.top;
    y += type.draw([{ text: 'ເສີຍຄຳຕອບ', bold: true }], left, y, width, TITLE_SIZE, {
      align: 'center',
    });
    y += type.draw([{ text: paper.title }], left, y, width, BODY_SIZE + 1, { align: 'center' });
    y += 12;

    // Table one: printed question number down, sets across.
    const columns = ['ຂໍ້', ...paper.variants.map((v) => `ຊຸດ ${v.label}`)];
    const rows = paper.questions.map((_, position) => [
      String(position + 1),
      ...paper.variants.map((variant) => {
        const original = paper.questions[variant.questionOrder[position]];
        const answer = answerFor(variant, position, original.correctIndex ?? null);
        return answer === null ? '—' : letters[answer];
      }),
    ]);
    y = this.drawTable(doc, type, left, y, width, columns, rows, { firstColumnWidth: 40 });

    // Table two: where each of the teacher's questions ended up, for a
    // teacher who wants to know how question 7 was answered across the room.
    y += 16;
    if (y > contentBottom(doc) - 80) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += type.draw(
      [{ text: 'ຕາຕະລາງທຽບຂໍ້: ຂໍ້ຕົ້ນສະບັບ ຢູ່ຂໍ້ໃດຂອງແຕ່ລະຊຸດ', bold: true }],
      left,
      y,
      width,
      BODY_SIZE,
    );
    y += 4;
    const positionsByOriginal = paper.questions.map((_, original) => [
      String(original + 1),
      ...paper.variants.map((variant) => String(variant.questionOrder.indexOf(original) + 1)),
    ]);
    this.drawTable(doc, type, left, y, width, columns, positionsByOriginal, {
      firstColumnWidth: 40,
    });

    doc.end();
    return finished;
  }

  /** ໃບແຈກຊຸດ — who gets which set, and a picture of the room. */
  async renderSeatPlan(plan: SeatPlanData): Promise<Buffer> {
    const { doc, finished } = openDocument(`ແຈກຊຸດ ${plan.title}`);
    const type = new Typesetter(doc);
    const { left } = doc.page.margins;
    const width = contentWidth(doc);
    const seated = seatClass(plan.students, plan.columns, plan.variants.length);
    const labelOf = (setIndex: number) => plan.variants[setIndex]?.label ?? '?';

    let y = doc.page.margins.top;
    y += type.draw([{ text: 'ໃບແຈກຊຸດບົດສອບ', bold: true }], left, y, width, TITLE_SIZE, {
      align: 'center',
    });
    y += type.draw([{ text: plan.title }], left, y, width, BODY_SIZE + 1, { align: 'center' });
    y += type.draw(
      [
        {
          text: `ຫ້ອງ ${plan.classroomName} · ນັ່ງ ${plan.columns} ຄົນຕໍ່ແຖວ · ${plan.variants.length} ຊຸດ`,
        },
      ],
      left,
      y,
      width,
      BODY_SIZE,
      { align: 'center' },
    );
    y += 12;

    // The room as seen from the front: one box per seat, the set in it and
    // the pupil's roll number, so the teacher can hand the sets out by
    // walking the rows.
    const rows = Math.ceil(seated.length / Math.max(1, plan.columns));
    const cell = Math.min(64, Math.floor(width / Math.max(1, plan.columns)) - 4);
    const gridWidth = plan.columns * (cell + 4);
    const gridLeft = left + (width - gridWidth) / 2;
    y += type.draw([{ text: 'ໜ້າຫ້ອງ (ກະດານ)', bold: true }], left, y, width, BODY_SIZE - 1, {
      align: 'center',
    });
    y += 2;
    for (let row = 0; row < rows; row += 1) {
      if (y + cell > contentBottom(doc)) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      for (let column = 0; column < plan.columns; column += 1) {
        const seat = seated[row * plan.columns + column];
        if (!seat) break;
        const x = gridLeft + column * (cell + 4);
        doc.rect(x, y, cell, cell).lineWidth(0.6).stroke('#555');
        type.draw([{ text: labelOf(seat.setIndex), bold: true }], x, y + 6, cell, 16, {
          align: 'center',
        });
        const who = seat.student.rollNumber
          ? `ລ/ດ ${seat.student.rollNumber}`
          : seat.student.studentCode;
        type.draw([{ text: who }], x, y + cell - 18, cell, 8, { align: 'center' });
      }
      y += cell + 4;
    }

    // The roll, for the register.
    y += 14;
    const columns = ['ລ/ດ', 'ລະຫັດ', 'ຊື່ ແລະ ນາມສະກຸນ', 'ແຖວ', 'ຊຸດ'];
    const table = seated.map((seat) => [
      seat.student.rollNumber === null ? '' : String(seat.student.rollNumber),
      seat.student.studentCode,
      seat.student.studentNameLo,
      String(seat.row + 1),
      labelOf(seat.setIndex),
    ]);
    this.drawTable(doc, type, left, y, width, columns, table, {
      widths: [36, 64, undefined, 40, 40],
      align: ['center', 'left', 'left', 'center', 'center'],
    });

    doc.end();
    return finished;
  }

  // ── The set ───────────────────────────────────────────────────────────────

  private drawHeader(
    doc: PDFKit.PDFDocument,
    type: Typesetter,
    paper: PrintPaper,
    label: string,
  ): void {
    const { left, top } = doc.page.margins;
    const width = contentWidth(doc);
    const logo = resolveLetterheadImages().schoolLogo;
    const logoSize = 46;
    let textLeft = left;

    if (logo) {
      try {
        doc.image(logo, left, top, { fit: [logoSize, logoSize] });
        textLeft = left + logoSize + 10;
      } catch (error) {
        this.logger.warn(
          `The school logo could not be drawn; continuing without it: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    // The set's letter in a box at the top right, large enough to be read
    // from the aisle — the invigilator checks the room by it.
    const boxWidth = 64;
    const boxHeight = 34;
    const boxX = left + width - boxWidth;
    doc.rect(boxX, top, boxWidth, boxHeight).lineWidth(1).stroke('#000');
    type.draw([{ text: `ຊຸດ ${label}`, bold: true }], boxX, top + 7, boxWidth, 15, {
      align: 'center',
    });

    // The teacher's own header, when the file had one — the school line, the
    // paper's title, the ຊື່/ຫ້ອງ line — printed as written beside the crest.
    // Only a paper with none gets the school's name and the title typed here,
    // so nothing is said twice.
    let y = top;
    const textWidth = boxX - 12 - textLeft;
    if (paper.preamble.trim()) {
      y += type.draw([{ text: paper.preamble }], textLeft, y, textWidth, BODY_SIZE);
    } else {
      y += type.draw([{ text: paper.schoolNameLo, bold: true }], textLeft, y, textWidth, BODY_SIZE);
      y += type.draw([{ text: paper.title, bold: true }], textLeft, y, textWidth, BODY_SIZE + 1);
    }
    y = Math.max(y, top + logoSize) + 6;

    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.7)
      .stroke('#000');
    doc.y = y + 8;
  }

  private drawQuestions(
    doc: PDFKit.PDFDocument,
    type: Typesetter,
    paper: PrintPaper,
    variant: Variant,
  ): void {
    const { left } = doc.page.margins;
    const width = contentWidth(doc);
    const letters = OPTION_LETTERS[paper.optionLabelStyle];
    let y = doc.y;
    let lastSection: string | null | undefined;

    variant.questionOrder.forEach((original, position) => {
      const question = paper.questions[original];
      const optionOrder = variant.optionOrders[position];

      const sectionBlock =
        question.section !== lastSection && question.section
          ? this.measureSection(type, question.section, width)
          : 0;
      const height = this.measureQuestion(type, question, optionOrder, letters, width);

      // Keep a question whole on a page where it can be; one taller than a
      // page has to flow, and does.
      if (y + sectionBlock + height > contentBottom(doc) && y > doc.page.margins.top) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      if (question.section !== lastSection && question.section) {
        y += type.draw([{ text: question.section, bold: true }], left, y, width, BODY_SIZE + 1, {
          align: 'center',
        });
        y += 4;
      }
      lastSection = question.section;

      y = this.drawQuestion(
        doc,
        type,
        question,
        position + 1,
        optionOrder,
        letters,
        left,
        y,
        width,
      );
      y += QUESTION_GAP;
    });
    doc.y = y;
  }

  private measureSection(type: Typesetter, section: string, width: number): number {
    return type.measure([{ text: section, bold: true }], width, BODY_SIZE + 1) + 4;
  }

  private stemSpans(number: number, question: PrintQuestion, width: number) {
    const { spans, unplaced } = spansWithImages(question.text, question.images, width - HANG);
    return { spans: [{ text: `${number}. `, bold: true }, ...spans], unplaced };
  }

  private optionSpans(letter: string, option: PrintOption, width: number) {
    const { spans, unplaced } = spansWithImages(option.text, option.images, width - HANG);
    return { spans: [{ text: `${letter}. ` }, ...spans], unplaced };
  }

  /**
   * Two to a line when every option is short and carries at most a small
   * picture in its line — an equation, not a figure.
   */
  private twoUp(
    type: Typesetter,
    question: PrintQuestion,
    letters: string[],
    width: number,
  ): boolean {
    const share = (width - HANG) * TWO_UP_SHARE;
    return question.options.every((option, index) => {
      const { spans, unplaced } = this.optionSpans(letters[index], option, width);
      if (unplaced.length > 0) return false;
      if (
        spans.some((span) => (span.image?.height ?? span.math?.height ?? 0) > TWO_UP_IMAGE_HEIGHT)
      ) {
        return false;
      }
      return type.widthOf(spans, BODY_SIZE) <= share;
    });
  }

  private imageBox(image: PrintImage, maxWidth: number): { width: number; height: number } {
    const scale = Math.min(1, maxWidth / image.widthPt, MAX_IMAGE_HEIGHT / image.heightPt);
    return { width: image.widthPt * scale, height: image.heightPt * scale };
  }

  private measureQuestion(
    type: Typesetter,
    question: PrintQuestion,
    optionOrder: number[],
    letters: string[],
    width: number,
  ): number {
    const stem = this.stemSpans(99, question, width);
    let height = type.measure(stem.spans, width, BODY_SIZE);
    for (const image of stem.unplaced) height += this.imageBox(image, width - HANG).height + 4;

    const optionWidth = width - HANG;
    if (this.twoUp(type, question, letters, width)) {
      for (let printed = 0; printed < optionOrder.length; printed += 2) {
        const pair = optionOrder
          .slice(printed, printed + 2)
          .map((originalIndex, i) =>
            type.measure(
              this.optionSpans(letters[printed + i], question.options[originalIndex], width).spans,
              optionWidth / 2,
              BODY_SIZE,
            ),
          );
        height += Math.max(...pair);
      }
      return height;
    }
    optionOrder.forEach((originalIndex, printed) => {
      const option = this.optionSpans(letters[printed], question.options[originalIndex], width);
      height += type.measure(option.spans, optionWidth, BODY_SIZE);
      for (const image of option.unplaced) {
        height += this.imageBox(image, optionWidth - HANG).height + 4;
      }
    });
    return height;
  }

  private drawImage(
    doc: PDFKit.PDFDocument,
    image: PrintImage,
    x: number,
    y: number,
    maxWidth: number,
  ): number {
    const box = this.imageBox(image, maxWidth);
    if (y + box.height > contentBottom(doc)) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    // A picture PDFKit cannot draw leaves its space and a frame, not a
    // failed set — and, for a damaged PNG, not a request that never returns.
    if (!isDrawable(image.buffer, image.mimeType)) {
      this.logger.warn('A picture could not be drawn (unreadable); leaving its space');
      doc.rect(x, y, box.width, box.height).lineWidth(0.5).stroke('#999');
      return y + box.height + 4;
    }
    try {
      doc.image(image.buffer, x, y, { width: box.width, height: box.height });
    } catch (error) {
      this.logger.warn(
        `A picture could not be drawn; continuing: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      doc.rect(x, y, box.width, box.height).lineWidth(0.5).stroke('#999');
    }
    return y + box.height + 4;
  }

  private drawQuestion(
    doc: PDFKit.PDFDocument,
    type: Typesetter,
    question: PrintQuestion,
    number: number,
    optionOrder: number[],
    letters: string[],
    left: number,
    y: number,
    width: number,
  ): number {
    y = this.ensureRoom(doc, type, y);
    const stem = this.stemSpans(number, question, width);
    y += type.draw(stem.spans, left, y, width, BODY_SIZE);
    for (const image of stem.unplaced) y = this.drawImage(doc, image, left + HANG, y, width - HANG);

    const optionLeft = left + HANG;
    const optionWidth = width - HANG;

    if (this.twoUp(type, question, letters, width)) {
      for (let printed = 0; printed < optionOrder.length; printed += 2) {
        y = this.ensureRoom(doc, type, y);
        let rowHeight = 0;
        optionOrder.slice(printed, printed + 2).forEach((originalIndex, i) => {
          const x = optionLeft + i * (optionWidth / 2);
          const drawn = type.draw(
            this.optionSpans(letters[printed + i], question.options[originalIndex], width).spans,
            x,
            y,
            optionWidth / 2,
            BODY_SIZE,
          );
          rowHeight = Math.max(rowHeight, drawn);
        });
        y += rowHeight;
      }
      return y;
    }

    optionOrder.forEach((originalIndex, printed) => {
      const option = this.optionSpans(letters[printed], question.options[originalIndex], width);
      y = this.ensureRoom(doc, type, y);
      y += type.draw(option.spans, optionLeft, y, optionWidth, BODY_SIZE);
      for (const image of option.unplaced) {
        y = this.drawImage(doc, image, optionLeft + HANG, y, optionWidth - HANG);
      }
    });
    return y;
  }

  /** A new page when even one more line would not fit. */
  private ensureRoom(doc: PDFKit.PDFDocument, type: Typesetter, y: number): number {
    if (y + type.lineHeight(BODY_SIZE) > contentBottom(doc)) {
      doc.addPage();
      return doc.page.margins.top;
    }
    return y;
  }

  /** `ຊຸດ A · ໜ້າ 2/3` at the foot of every page of a set. */
  private drawFooters(
    doc: PDFKit.PDFDocument,
    type: Typesetter,
    firstPage: number,
    label: string,
  ): void {
    const range = doc.bufferedPageRange();
    const lastPage = range.start + range.count - 1;
    const pages = lastPage - firstPage + 1;
    for (let page = firstPage; page <= lastPage; page += 1) {
      doc.switchToPage(page);
      const y = doc.page.height - doc.page.margins.bottom + 16;
      type.draw(
        [{ text: `${label} · ໜ້າ ${page - firstPage + 1}/${pages}` }],
        doc.page.margins.left,
        y,
        contentWidth(doc),
        8,
        { align: 'center' },
      );
    }
    doc.switchToPage(lastPage);
  }

  // ── Tables ────────────────────────────────────────────────────────────────

  private drawTable(
    doc: PDFKit.PDFDocument,
    type: Typesetter,
    left: number,
    y: number,
    width: number,
    header: string[],
    rows: string[][],
    options: {
      firstColumnWidth?: number;
      widths?: (number | undefined)[];
      align?: ('left' | 'center')[];
    } = {},
  ): number {
    const fixed =
      options.widths ?? header.map((_, i) => (i === 0 ? options.firstColumnWidth : undefined));
    const fixedTotal = fixed.reduce<number>((sum, w) => sum + (w ?? 0), 0);
    const flexible = fixed.filter((w) => w === undefined).length;
    const widths = fixed.map((w) => w ?? (width - fixedTotal) / Math.max(1, flexible));
    const align = options.align ?? header.map(() => 'center' as const);
    const rowHeight = type.lineHeight(BODY_SIZE) + 4;
    const pad = 4;

    const drawRow = (cells: string[], bold: boolean) => {
      if (y + rowHeight > contentBottom(doc)) {
        doc.addPage();
        y = doc.page.margins.top;
        if (!bold) drawRow(header, true);
      }
      let x = left;
      cells.forEach((cell, i) => {
        doc.rect(x, y, widths[i], rowHeight).lineWidth(0.5).stroke('#333');
        type.draw([{ text: cell, bold }], x + pad, y + 2, widths[i] - pad * 2, BODY_SIZE, {
          align: align[i],
        });
        x += widths[i];
      });
      y += rowHeight;
    };

    drawRow(header, true);
    for (const row of rows) drawRow(row, false);
    return y;
  }
}
