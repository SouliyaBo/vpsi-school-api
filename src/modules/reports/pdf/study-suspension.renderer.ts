import { Injectable } from '@nestjs/common';
import { LAO_MONTHS, formatLaoDateSlash } from 'src/common/utils/lao-date';
import { OfficialLetterRenderer, Span } from './official-letter.renderer';

/** Everything printed on a `ບົດບັນທຶກ ຂໍໂຈະການຮຽນ`. */
export interface StudySuspensionData {
  school: {
    authorityLo: string;
    /** `ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ` — also how the closing names the place. */
    nameLo: string;
    provinceLo: string;
    phone: string;
    /** Signature line on the left, opposite the guardian's. */
    principalTitleLo: string;
  };
  memo: {
    /** Already formatted, e.g. `100/ວຈພທນ(ຄນຮ)`. */
    numberLo: string;
    issuedDate: Date;
  };
  /** The parent who asks for the suspension and signs the memo. */
  guardian: {
    /** With the title the form prints: `ທ້າວ ສະຫງ່ວນ ປອງປັນຍາ`. */
    nameLo: string | null;
    phone: string | null;
    /** Bare names — the form supplies `ບ້ານ`, `ເມືອງ`, `ແຂວງ` itself. */
    villageLo: string | null;
    districtLo: string | null;
    provinceLo: string | null;
  };
  student: {
    /** `ທ້າວ` or `ນາງ`. */
    titleLo: string;
    fullNameLo: string;
    studentCode: string;
    /** `ມ.1/ກ` — this form names the section, unlike the study letter. */
    classLabelLo: string | null;
  };
  suspension: {
    /** `2026-2027` — the year the pupil leaves the roll. */
    schoolYearCode: string | null;
    /** The first day the pupil is off the roll. */
    fromDate: Date | null;
    /** Printed after `ເຫດຜົນໃນການໂຈະຍ້ອນ:`; null leaves ruled lines. */
    reasonLo: string | null;
    /** One per line after `ເອກະສານສົ່ງຜູ້ປົກຄອງມີຄື:`; empty leaves ruled lines. */
    documentsLo: string[];
  };
}

/**
 * Renders the memo a parent signs to take a pupil off the Lao-programme roll.
 *
 * The reason and the documents handed back are chosen per memo from the
 * office's list (or typed); when neither was given the form keeps its ruled
 * lines, so a memo can still be printed blank and completed at the counter.
 */
@Injectable()
export class StudySuspensionRenderer extends OfficialLetterRenderer {
  render(data: StudySuspensionData): Promise<Buffer> {
    return this.renderLetter(
      { school: data.school, numberLo: data.memo.numberLo, issuedDate: data.memo.issuedDate },
      'ບົດບັນທຶກ ຂໍໂຈະການຮຽນ',
      (doc) => {
        this.drawTitle(doc);
        this.drawBody(doc, data);
        this.drawSignature(doc, data);
      },
    );
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  private drawTitle(doc: PDFKit.PDFDocument): void {
    doc.fontSize(19);
    this.line(doc, 'ບົດບັນທຶກ', { align: 'center', bold: true });
    doc.y += 10;
  }

  private drawBody(doc: PDFKit.PDFDocument, data: StudySuspensionData): void {
    const { guardian, student, suspension } = data;
    doc.fontSize(11.5);
    const or = (value: string | null | undefined): string => this.or(value);
    const year = or(suspension.schoolYearCode);
    const fromDate = suspension.fromDate ? formatLaoDateSlash(suspension.fromDate) : this.or(null);
    const fromMonth = suspension.fromDate
      ? (LAO_MONTHS[suspension.fromDate.getUTCMonth() + 1] ?? '')
      : this.or(null);

    // The form's opening lines are a header, not prose: each stands on its own
    // line, so they are set as short paragraphs rather than one justified block.
    this.paragraph(doc, [{ text: 'ເລື່ອງ: ', bold: true }, { text: 'ຂໍໂຈະການຮຽນພາກລາວ.' }]);
    this.paragraph(doc, [{ text: 'ຊື່ (ຜູ້ປົກຄອງ) ' }, { text: or(guardian.nameLo), bold: true }]);
    this.paragraph(
      doc,
      [
        { text: 'ບ້ານຢູ່ປັດຈຸບັນ ' },
        { text: or(guardian.villageLo), bold: true },
        { text: ' ເມືອງ ' },
        { text: or(guardian.districtLo), bold: true },
        { text: ' ແຂວງ ' },
        { text: or(guardian.provinceLo), bold: true },
      ],
      { indent: 0 },
    );
    this.paragraph(doc, [{ text: 'ເບີໂທ ' }, { text: or(guardian.phone), bold: true }], {
      indent: 0,
    });

    this.paragraph(doc, [
      { text: 'ມີຈຸດປະສົງ: ', bold: true },
      { text: 'ຂໍໂຈະການຮຽນພາກລາວຂອງ ' },
      { text: `${student.titleLo} ${student.fullNameLo}`, bold: true },
      { text: ' ລ.ຕ ' },
      { text: or(student.studentCode), bold: true },
      { text: ' ຊັ້ນຮຽນ ຫ້ອງ ' },
      { text: `${or(student.classLabelLo)},`, bold: true },
      { text: ' ໃນສົກຮຽນ ' },
      { text: year, bold: true },
      { text: ' ໃນໄລຍະ ວັນທີ/ເດືອນ/ປີ ' },
      { text: fromDate, bold: true },
      { text: ' ຂອງສົກຮຽນ ' },
      { text: year, bold: true },
      { text: ' ເປັນຕົ້ນໄປ.' },
    ]);

    if (suspension.reasonLo?.trim()) {
      this.paragraph(doc, [
        { text: 'ເຫດຜົນໃນການໂຈະຍ້ອນ: ', bold: true },
        { text: suspension.reasonLo.trim() },
      ]);
    } else {
      this.ruledField(doc, 'ເຫດຜົນໃນການໂຈະຍ້ອນ:', 2);
    }

    const documents = suspension.documentsLo.map((entry) => entry.trim()).filter(Boolean);
    if (documents.length > 0) {
      this.paragraph(doc, [{ text: 'ເອກະສານສົ່ງຜູ້ປົກຄອງມີຄື:', bold: true }], { justify: false });
      documents.forEach((entry, index) => {
        this.paragraph(doc, [{ text: `${index + 1}. ${entry}` }], { indent: 48, justify: false });
      });
    } else {
      this.ruledField(doc, 'ເອກະສານສົ່ງຜູ້ປົກຄອງມີຄື:', 4);
    }
    doc.y += 4;

    this.paragraph(doc, [
      { text: 'ສະນັ້ນ, ', bold: true },
      {
        text:
          // Spaced by phrase, which is how the sentence is read aloud and the
          // only break opportunities the typesetter gets in Lao.
          'ທາງພາກພາສາລາວ ຈຶ່ງໄດ້ຕົກລົງເຫັນດີ ເປັນເອກະພາບກັນວ່າ: ສຳລັບນັກຮຽນ ' +
          'ທີ່ໂຈະການຮຽນພາກພາສາລາວ ໃນກໍລະນີ ມາພົວພັນເອົາເອກະສານໃດໆ ທາງໂຮງຮຽນ ' +
          'ຈະບໍ່ໄດ້ອອກໃຫ້ ທຸກກໍລະນີ ເພາະໄດ້ສົ່ງຄືນ ຜູ້ປົກຄອງສຳເລັດ ນັບແຕ່ມື້ລົງລາຍເຊັນ ເປັນຕົ້ນໄປ.',
      },
    ]);
    doc.y += 6;

    this.paragraph(doc, [
      { text: 'ດັ່ງນັ້ນ, ', bold: true },
      {
        text: 'ຈຶ່ງຂຽນບົດບັນທຶກສະບັບນີ້ ໄວ້ເປັນຫຼັກຖານ ແລະ ມີຜົນນັບແຕ່ມື້ລົງລາຍເຊັນ ເປັນຕົ້ນໄປ.',
      },
    ]);
    doc.y += 6;

    this.paragraph(doc, [
      { text: 'ໝາຍເຫດ: ', bold: true },
      {
        text:
          'ຂ້າພະເຈົ້າຮັບຮູ້ ແລະ ຍິນຍອມວ່າ: ໃນການໂຈະການຮຽນພາສາລາວ ທາງໂຮງຮຽນ ' +
          'ຈະບໍ່ໄດ້ເອົາລາຍຊື່ ເຂົ້າໃນສະຖິຕິຂອງນັກຮຽນ ເລີ່ມແຕ່ ເດືອນ ',
      },
      { text: fromMonth, bold: true },
      { text: ' ສົກຮຽນ ' },
      { text: year, bold: true },
      { text: ' ເປັນຕົ້ນໄປ.' },
    ]);
  }

  /**
   * A bold label followed by ruled lines for the office to write on.
   *
   * The first rule starts where the label ends and runs to the margin; the rest
   * span the measure. Drawn as rules rather than as a run of underscores so the
   * line is continuous whatever face the label was set in.
   */
  private ruledField(doc: PDFKit.PDFDocument, label: string, lines: number): void {
    const left = doc.page.margins.left;
    const right = left + this.contentWidth(doc);
    const indent = 28;
    const lineHeight = this.lineHeight(doc) * 1.34;
    const labelSpans: Span[] = [{ text: label, bold: true }];
    const labelWidth = this.widthOf(doc, labelSpans);

    let y = doc.y;
    this.paragraph(doc, labelSpans, { indent, justify: false });
    // The rule sits a hair under the baseline the paragraph drew on.
    const baseline = y + lineHeight * 0.72 + 3;
    doc
      .moveTo(left + indent + labelWidth + 6, baseline)
      .lineTo(right, baseline)
      .lineWidth(0.6)
      .stroke();
    y = doc.y;

    for (let index = 1; index < lines; index += 1) {
      const ruleY = y + lineHeight * 0.72 + 3;
      doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(0.6).stroke();
      y += lineHeight;
    }
    doc.y = y;
    doc.x = left;
  }

  /**
   * Place and date on the right, then the two signing lines — the principal on
   * the left, the guardian on the right — with room under each to sign.
   */
  private drawSignature(doc: PDFKit.PDFDocument, data: StudySuspensionData): void {
    const { left } = doc.page.margins;
    const width = this.contentWidth(doc);
    const x = left + width * 0.5;
    const columnWidth = width * 0.5;
    const issued = data.memo.issuedDate;

    doc.y += 18;
    doc.fontSize(11);
    this.line(doc, `ທີ່ ${data.school.nameLo}`, { x, width: columnWidth, align: 'center' });
    doc.y += 3;
    this.line(
      doc,
      `ວັນທີ ${issued.getUTCDate()} ເດືອນ ${LAO_MONTHS[issued.getUTCMonth() + 1] ?? ''} ` +
        `ປີ ${issued.getUTCFullYear()}`,
      { x, width: columnWidth, align: 'center' },
    );
    doc.y += 3;

    const y = doc.y;
    this.line(doc, data.school.principalTitleLo, {
      x: left,
      y,
      width: columnWidth,
      align: 'center',
    });
    this.line(doc, 'ຜູ້ປົກຄອງ', { x, y, width: columnWidth, align: 'center' });
  }
}
