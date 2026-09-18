import { Injectable, Logger } from '@nestjs/common';
import QRCode from 'qrcode';
import { ExamOptionLabelStyle } from 'src/common/constants/enums';
import { resolveLetterheadImages } from 'src/modules/reports/pdf/study-certificate-assets';
import {
  answerSheetLayout,
  AnswerSheetLayout,
  MIN_CODE_DIGITS,
  Point,
  qrText,
} from './answer-sheet.layout';
import { OPTION_LETTERS } from './exam-paper.renderer';
import { contentWidth, openDocument, Typesetter } from './typesetter';

/**
 * ເຈ້ຍຕອບ — the bubble answer sheet, after the one the school already uses.
 *
 * Same bones as that sheet, because the pupils know it: crest and title,
 * the pupil's code as columns of digits to fill, two invigilator boxes, six
 * lines of particulars, two lines of instructions, then the answers in
 * blocks of twelve. Two things are added for the machine that reads it —
 * a black square at every corner and at the head of every block, so a
 * photograph can be straightened and the blocks found; and a QR code that
 * names the paper, the set and the pupil, so a stack of photographs sorts
 * itself. A personalised sheet has the code and set bubbles filled in
 * already: a pupil who fills their own code wrong is a mark for nobody.
 *
 * Every bubble is drawn where `answerSheetLayout` says, and nowhere else.
 */

export interface AnswerSheetPupil {
  studentId: string;
  studentCode: string;
  studentNameLo: string;
  set: string;
}

export interface AnswerSheetData {
  paperId: string;
  title: string;
  subjectLo: string | null;
  classroomName: string | null;
  schoolNameLo: string;
  questionCount: number;
  optionCount: number;
  optionLabelStyle: ExamOptionLabelStyle;
  /** The sets the paper has — one bubble each. */
  sets: string[];
  /** Named sheets; a blank sheet is `null`. */
  pupils: (AnswerSheetPupil | null)[];
}

const BODY = 9.5;
const VERSION = 'VPSI-OMR 1';

@Injectable()
export class AnswerSheetRenderer {
  private readonly logger = new Logger(AnswerSheetRenderer.name);

  async render(data: AnswerSheetData): Promise<Buffer> {
    const { doc, finished } = openDocument(`ເຈ້ຍຕອບ ${data.title}`);
    const type = new Typesetter(doc);
    const layout = answerSheetLayout({
      questionCount: data.questionCount,
      optionCount: data.optionCount,
      codeDigits: Math.max(
        MIN_CODE_DIGITS,
        ...data.pupils.map((pupil) => pupil?.studentCode.length ?? 0),
      ),
      setCount: data.sets.length,
    });
    if (layout.capacity < data.questionCount) {
      this.logger.warn(
        `Answer sheet holds ${layout.capacity} questions; ${data.questionCount - layout.capacity} omitted`,
      );
    }

    for (let index = 0; index < data.pupils.length; index += 1) {
      if (index > 0) doc.addPage();
      await this.page(doc, type, data, layout, data.pupils[index]);
    }

    doc.end();
    return finished;
  }

  private async page(
    doc: PDFKit.PDFDocument,
    type: Typesetter,
    data: AnswerSheetData,
    layout: AnswerSheetLayout,
    pupil: AnswerSheetPupil | null,
  ): Promise<void> {
    const { left, top } = doc.page.margins;
    const width = contentWidth(doc);
    const right = left + width;
    const half = layout.fiducialSize / 2;

    for (const corner of layout.corners)
      this.fiducial(doc, layout, corner.x - half, corner.y - half);

    // ── Head: crest, title, the code and set columns ──────────────────────
    const logo = resolveLetterheadImages().schoolLogo;
    const logoSize = 48;
    const headTop = top + layout.fiducialSize + 4;
    if (logo) {
      try {
        doc.image(logo, left + layout.fiducialSize + 6, headTop, { fit: [logoSize, logoSize] });
      } catch (error) {
        this.logger.warn(
          `The school logo could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const { code, sets, pitch, bubbleRadius } = layout;
    const codeWidth = code.digits * pitch;
    const setWidth = pitch + 4;
    type.draw([{ text: 'ລະຫັດນັກຮຽນ', bold: true }], code.left - 6, headTop, codeWidth + 12, 8, {
      align: 'center',
    });
    type.draw([{ text: 'ຊຸດ', bold: true }], sets.left - 4, headTop, setWidth + 8, 8, {
      align: 'center',
    });
    const paddedCode = pupil?.studentCode.padStart(code.digits, '0') ?? null;
    for (let d = 0; d < code.digits; d += 1) {
      doc
        .rect(code.left + d * pitch + 1, code.boxesTop, pitch - 2, 13)
        .lineWidth(0.6)
        .stroke('#000');
      if (paddedCode) {
        type.draw([{ text: paddedCode[d] }], code.left + d * pitch, code.boxesTop + 1, pitch, 9, {
          align: 'center',
        });
      }
    }
    for (let digit = 0; digit < 10; digit += 1) {
      const first = code.bubble(0, digit);
      type.draw([{ text: String(digit) }], code.left - 12, first.y - 5, 10, 7, { align: 'right' });
      for (let d = 0; d < code.digits; d += 1) {
        this.bubble(
          doc,
          layout,
          code.bubble(d, digit),
          paddedCode !== null && Number(paddedCode[d]) === digit,
        );
      }
    }
    data.sets.forEach((set, index) => {
      const centre = sets.bubble(index);
      type.draw([{ text: set }], sets.left - 12, centre.y - 5, 10, 7, { align: 'right' });
      this.bubble(doc, layout, centre, pupil?.set === set);
    });

    const titleLeft = left + layout.fiducialSize + 6 + logoSize + 10;
    const titleWidth = code.left - 30 - titleLeft;
    let ty = headTop + 2;
    ty += type.draw(
      [{ text: `ເຈ້ຍຕອບ ${data.title}`, bold: true }],
      titleLeft,
      ty,
      titleWidth,
      12,
      {
        align: 'center',
      },
    );
    const subtitle = [data.subjectLo ? `ວິຊາ ${data.subjectLo}` : null, data.schoolNameLo]
      .filter(Boolean)
      .join(' · ');
    type.draw([{ text: subtitle }], titleLeft, ty, titleWidth, BODY, { align: 'center' });

    // ── Invigilator boxes and the particulars — at a fixed height ─────────
    const py = layout.particularsTop;
    const boxLeft = left + layout.fiducialSize + 6;
    const boxWidth = 92;
    const linesLeft = boxLeft + boxWidth + 10;
    const linesWidth = code.left - 30 - linesLeft;
    const lineHeight = 17;
    const particulars = [
      ['ຊື່-ນາມສະກຸນ', pupil?.studentNameLo ?? null],
      ['ຫ້ອງຮຽນ', data.classroomName],
      ['ຫ້ອງສອບເສັງ', null],
      ['ວັນທີສອບ', null],
      ['ຊຸດບົດສອບ', pupil?.set ?? null],
      ['ລາຍເຊັນນັກຮຽນ', null],
    ] as const;
    const blockHeight = particulars.length * lineHeight + 8;

    for (let i = 0; i < 2; i += 1) {
      const by = py + (i * blockHeight) / 2;
      doc
        .rect(boxLeft, by, boxWidth, blockHeight / 2 - 3)
        .lineWidth(0.8)
        .stroke('#000');
      type.draw([{ text: `ກຳມະການກວດບົດ\nຜູ້ທີ ${i + 1}` }], boxLeft, by + 6, boxWidth, BODY, {
        align: 'center',
      });
    }
    doc.rect(linesLeft, py, linesWidth, blockHeight).lineWidth(0.8).stroke('#000');
    particulars.forEach(([label, value], i) => {
      const ly = py + 6 + i * lineHeight;
      const labelWidth = 86;
      type.draw([{ text: `${i + 1}. ${label}:` }], linesLeft + 6, ly, labelWidth, BODY);
      const fieldLeft = linesLeft + 6 + labelWidth;
      const fieldWidth = linesWidth - 12 - labelWidth;
      if (value) {
        type.draw([{ text: value, bold: true }], fieldLeft, ly, fieldWidth, BODY);
      } else {
        doc
          .moveTo(fieldLeft, ly + 11)
          .lineTo(fieldLeft + fieldWidth, ly + 11)
          .lineWidth(0.4)
          .dash(1, { space: 2 })
          .stroke('#000')
          .undash();
      }
    });

    // ── Instructions ──────────────────────────────────────────────────────
    let iy = layout.instructionsTop;
    iy += type.draw(
      [{ text: 'ຄຳແນະນຳ:', bold: true }],
      boxLeft,
      iy,
      width - 2 * layout.fiducialSize,
      BODY,
    );
    type.draw(
      [
        {
          text:
            '- ໃຊ້ບິກຝົນໃຫ້ເຕັມວົງຄຳຕອບທີ່ເລືອກ ໜຶ່ງຂໍ້ຝົນວົງດຽວ; ຝົນສອງວົງຖືວ່າບໍ່ຕອບ\n' +
            '- ຢ່າຂີດຂ້າ ຫຼື ລຶບ; ຮັກສາເຈ້ຍໃຫ້ສະອາດ ບໍ່ພັບ ບໍ່ຂຽນທັບເຄື່ອງໝາຍສີດຳ',
        },
      ],
      boxLeft + 6,
      iy,
      width - 2 * layout.fiducialSize - 12,
      BODY,
    );

    // ── The answers ───────────────────────────────────────────────────────
    const letters = OPTION_LETTERS[data.optionLabelStyle].slice(0, layout.optionCount);
    for (const block of layout.blocks) {
      this.fiducial(doc, layout, block.origin.x, block.origin.y);
      const first = layout.question(block.numbers[0]);
      if (!first) continue;
      first.forEach((centre, i) => {
        this.bubble(doc, layout, { x: centre.x, y: block.headY }, false);
        type.draw(
          [{ text: letters[i], bold: true }],
          centre.x - 5,
          block.headY - bubbleRadius - 0.5,
          10,
          7,
          {
            align: 'center',
          },
        );
      });
      for (const number of block.numbers) {
        const centres = layout.question(number);
        const label = layout.questionLabel(number);
        if (!centres || !label) continue;
        type.draw([{ text: String(number), bold: true }], label.x - 18, label.y - 5, 18, 8, {
          align: 'right',
        });
        for (const centre of centres) this.bubble(doc, layout, centre, false);
      }
    }

    // ── Foot: the set in words, the QR, the version ───────────────────────
    const footY = layout.corners[2].y - half - 2;
    type.draw(
      [
        {
          text: pupil
            ? `ຊຸດ ${pupil.set} · ${pupil.studentNameLo}`
            : 'ເຈ້ຍຕອບສຳຮອງ — ຝົນລະຫັດ ແລະ ຊຸດເອງ',
        },
      ],
      boxLeft + layout.fiducialSize,
      footY + 2,
      width / 2,
      8,
    );
    type.draw([{ text: VERSION }], right - layout.fiducialSize - 120, footY + 2, 100, 7, {
      align: 'right',
    });
    await this.qr(
      doc,
      qrText(data.paperId, pupil?.set ?? null, pupil?.studentId ?? null),
      layout.qr.x,
      layout.qr.y,
      layout.qr.size,
    );
  }

  private fiducial(doc: PDFKit.PDFDocument, layout: AnswerSheetLayout, x: number, y: number): void {
    doc.rect(x, y, layout.fiducialSize, layout.fiducialSize).fill('#000');
  }

  private bubble(
    doc: PDFKit.PDFDocument,
    layout: AnswerSheetLayout,
    centre: Point,
    filled: boolean,
  ): void {
    doc.circle(centre.x, centre.y, layout.bubbleRadius).lineWidth(0.7);
    if (filled) doc.fillAndStroke('#000', '#000');
    else doc.stroke('#333');
  }

  /** The QR as rectangles — no raster, so it prints sharp at any size. */
  private async qr(
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    y: number,
    size: number,
  ): Promise<void> {
    const code = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const modules = code.modules;
    const cell = size / modules.size;
    for (let row = 0; row < modules.size; row += 1) {
      for (let col = 0; col < modules.size; col += 1) {
        if (modules.get(row, col))
          doc.rect(x + col * cell, y + row * cell, cell, cell).fill('#000');
      }
    }
  }
}
