import { Injectable } from '@nestjs/common';
import { formatLaoDateLong, formatLaoDateSlash } from 'src/common/utils/lao-date';
import { OfficialLetterRenderer } from './official-letter.renderer';

/** Everything printed on a `ໃບຢັ້ງຢືນການສຶກສາ`. */
export interface StudyCertificateData {
  school: {
    /** `ພະແນກສຶກສາທິການ ແລະ ກີລາ` — the department above the school. */
    authorityLo: string;
    /** Short form used on the letterhead: `ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ`. */
    nameLo: string;
    /**
     * The spelled-out name **without** the word `ໂຮງຮຽນ`, e.g. `ມັດທະຍົມສົມບູນ
     * ນານາຊາດ ວຽງຈັນພັດທະນາ`.
     *
     * The letter's sentences supply that word themselves — `ອຳນວຍການໂຮງຮຽນ …`
     * and `ຮຽນທີ່ ໂຮງຮຽນ …` — so a stored name that repeats it prints
     * "ອຳນວຍການໂຮງຮຽນ ໂຮງຮຽນ ມັດທະຍົມສົມບູນ".
     */
    nameFullLo: string;
    provinceLo: string;
    phone: string;
    /** Where the school itself stands, as the closing paragraph states it. */
    addressLo: string;
    principalTitleLo: string;
  };
  certificate: {
    /** Already formatted, e.g. `99/ວຈພທນ(ຄນຮ)`. */
    numberLo: string;
    issuedDate: Date;
  };
  student: {
    /** `ທ້າວ` or `ນາງ`. */
    titleLo: string;
    fullNameLo: string;
    dateOfBirth: Date | null;
    birthPlaceLo: string | null;
    fatherNameLo: string | null;
    motherNameLo: string | null;
    currentAddressLo: string | null;
    studentCode: string;
    /** `ມ.4` — how the letter names the class, not the classroom's full name. */
    classLabelLo: string | null;
  };
  study: {
    fromYearCode: string | null;
    toYearCode: string | null;
  };
}

/**
 * Renders the school's study-verification letter — one fixed piece of official
 * prose with the pupil's details dropped into its sentences. The letterhead and
 * the typesetting come from `OfficialLetterRenderer`.
 */
@Injectable()
export class StudyCertificateRenderer extends OfficialLetterRenderer {
  render(data: StudyCertificateData): Promise<Buffer> {
    return this.renderLetter(
      {
        school: data.school,
        numberLo: data.certificate.numberLo,
        issuedDate: data.certificate.issuedDate,
      },
      'ໃບຢັ້ງຢືນການສຶກສາ',
      (doc) => {
        this.drawTitle(doc);
        this.drawBody(doc, data);
        this.drawSignature(doc, data);
      },
    );
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  private drawTitle(doc: PDFKit.PDFDocument): void {
    doc.fontSize(21);
    this.line(doc, 'ໃບຢັ້ງຢືນການສຶກສາ', { align: 'center', bold: true });
    doc.y += 16;
  }

  private drawBody(doc: PDFKit.PDFDocument, data: StudyCertificateData): void {
    const { student, school, study, certificate } = data;
    doc.fontSize(11.5);
    const or = (value: string | null | undefined): string => this.or(value);

    this.paragraph(
      doc,
      [{ text: `ຂ້າພະເຈົ້າ ອຳນວຍການໂຮງຮຽນ ${school.nameFullLo} ຂໍຢັ້ງຢືນວ່າ:` }],
      {
        align: 'center',
      },
    );
    doc.y += 12;

    this.paragraph(
      doc,
      [
        { text: `${student.titleLo} ${student.fullNameLo}`, bold: true },
        { text: ' ເກີດເມື່ອ ວັນທີ ' },
        { text: or(formatLaoDateLong(student.dateOfBirth)), bold: true },
        { text: ' ບ່ອນເກີດ: ' },
        { text: or(student.birthPlaceLo), bold: true },
        { text: ' ເປັນລູກຂອງ ' },
        { text: or(student.fatherNameLo), bold: true },
        { text: ' ແລະ ' },
        { text: or(student.motherNameLo), bold: true },
        { text: ' ປັດຈຸບັນຢູ່: ' },
        { text: `${or(student.currentAddressLo)}.`, bold: true },
      ],
      { indent: 0 },
    );
    doc.y += 12;

    this.paragraph(doc, [
      { text: `ໄດ້ເຂົ້າມາຮຽນຢູ່ທີ່ ${school.nameLo} ແຕ່ ສົກຮຽນ ` },
      { text: or(study.fromYearCode), bold: true },
      { text: ' ເຖິງ ສົກຮຽນ ' },
      { text: or(study.toYearCode), bold: true },
      { text: ' ແມ່ນຮຽນຢູ່ ຫ້ອງ ' },
      { text: or(student.classLabelLo), bold: true },
      { text: ' ເລກປະຈຳຕົວ ' },
      { text: `${or(student.studentCode)}.`, bold: true },
      {
        text:
          ` ຜູ້ກ່ຽວແມ່ນຮຽນທີ່ ໂຮງຮຽນ ${school.nameFullLo} ແທ້, ` +
          `ສະຖານທີ່ຕັ້ງຢູ່ ${school.addressLo}.`,
      },
    ]);
    doc.y += 12;

    this.paragraph(doc, [
      {
        text:
          'ດັ່ງນັ້ນ, ຈຶ່ງໄດ້ອອກໃບຢັ້ງຢືນສະບັບນີ້ໄວ້ໃຫ້ຜູ້ກ່ຽວໄວ້ໃຊ້ເປັນ' +
          'ຫຼັກຖານປະກອບເອກະສານຕ່າງໆ.',
      },
    ]);

    // Referenced so a future edit that drops the number from the body still has
    // it available here rather than silently losing the reference.
    void certificate;
  }

  private drawSignature(doc: PDFKit.PDFDocument, data: StudyCertificateData): void {
    const { left } = doc.page.margins;
    const width = this.contentWidth(doc);
    const x = left + width * 0.45;
    const columnWidth = width * 0.55;

    doc.y += 26;
    doc.fontSize(11);
    this.line(doc, `ທີ່ ${data.school.nameLo}`, { x, width: columnWidth, align: 'right' });
    doc.y += 3;
    this.line(doc, `ວັນທີ ${formatLaoDateSlash(data.certificate.issuedDate)}`, {
      x,
      width: columnWidth,
      align: 'right',
    });
    doc.y += 3;
    this.line(doc, data.school.principalTitleLo, { x, width: columnWidth, align: 'right' });
  }
}
