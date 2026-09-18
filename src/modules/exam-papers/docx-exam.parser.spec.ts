import {
  AlignmentType,
  Document,
  ImageRun,
  LevelFormat,
  Math as WordMath,
  MathFraction,
  MathRun,
  MathSuperScript,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { parseExamDocx } from './docx-exam.parser';

/**
 * The parser reads conventions, not a format, so the fixtures here are the
 * layouts teachers actually hand in: options two to a line with a tab between,
 * one per line, in a table, auto-numbered by Word, with the answer in bold —
 * and the things that look like markers but are not.
 */

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function line(...runs: (string | TextRun)[]): Paragraph {
  return new Paragraph({
    children: runs.map((run) => (typeof run === 'string' ? new TextRun(run) : run)),
  });
}

const bold = (text: string) => new TextRun({ text, bold: true });
const tab = () => new TextRun({ children: ['\t'] });

async function build(
  children: (Paragraph | Table)[],
  numbering?: ConstructorParameters<typeof Document>[0]['numbering'],
) {
  const doc = new Document({ numbering, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

describe('parseExamDocx', () => {
  it('reads the sample sheet: two options per line, the bold one is the answer', async () => {
    const file = await build([
      line('ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ'),
      line('ບົດສອບປາລະໄນ ວິຊາ ພູມສາດ'),
      line('1. ປະເທດລາວເຮົາ ບໍ່ໄດ້ຮັບຜົນກະທົບຮ້າຍແຮງຈາກລົມພາຍຸ ຍ້ອນຫຍັງ?'),
      line('A. ອ້ອມຮອບດ້ວຍສາຍພູສູງ', tab(), bold('B. ບໍ່ຕິດກັບທະເລ ແລະ ຖືກກັ້ນຈາກສາຍພູ')),
      line('C. ມີພູພຽງກອມ', tab(), 'D. ບໍ່ຕັ້ງຢູ່ໃນທິດກະແສ'),
      line('2. ປະເທດລາວຕັ້ງຢູ່ທິດໃດຂອງທະວີບອາຊີ?'),
      line('A. ທິດໃຕ້', tab(), 'B. ທິດເໜືອ'),
      line(bold('C. ທິດຕາເວັນອອກສຽງໃຕ້'), tab(), 'D. ທິດຕາເວັນອອກສຽງເໜືອ'),
    ]);

    const exam = await parseExamDocx(file);

    expect(exam.preamble).toBe('ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ\nບົດສອບປາລະໄນ ວິຊາ ພູມສາດ');
    expect(exam.questions).toHaveLength(2);
    expect(exam.optionLabelStyle).toBe('latin');
    expect(exam.warnings).toEqual([]);

    const [first, second] = exam.questions;
    expect(first.text).toBe('ປະເທດລາວເຮົາ ບໍ່ໄດ້ຮັບຜົນກະທົບຮ້າຍແຮງຈາກລົມພາຍຸ ຍ້ອນຫຍັງ?');
    expect(first.options.map((o) => o.text)).toEqual([
      'ອ້ອມຮອບດ້ວຍສາຍພູສູງ',
      'ບໍ່ຕິດກັບທະເລ ແລະ ຖືກກັ້ນຈາກສາຍພູ',
      'ມີພູພຽງກອມ',
      'ບໍ່ຕັ້ງຢູ່ໃນທິດກະແສ',
    ]);
    expect(first.correctIndex).toBe(1);
    expect(second.correctIndex).toBe(2);
  });

  it('does not read ສ.ປ.ປ in a stem as option six, and warns when no answer is bold', async () => {
    const file = await build([
      line('4. ທິດຕາເວັນອອກຂອງ ສ.ປ.ປ.ລາວ ຕິດກັບປະເທດໃດ?'),
      line('A. ກຳປູເຈຍ'),
      line('B. ມຽນມາ'),
      line('C. ຫວຽດນາມ'),
      line('D. ໄທ'),
    ]);

    const exam = await parseExamDocx(file);

    expect(exam.questions).toHaveLength(1);
    expect(exam.questions[0].text).toBe('ທິດຕາເວັນອອກຂອງ ສ.ປ.ປ.ລາວ ຕິດກັບປະເທດໃດ?');
    expect(exam.questions[0].options).toHaveLength(4);
    expect(exam.questions[0].correctIndex).toBeNull();
    expect(exam.warnings).toEqual([{ code: 'noAnswer', question: 1 }]);
  });

  it('reads Lao letters, a part heading, and an underlined answer', async () => {
    const file = await build([
      line('ພາກ I'),
      line('1. ຄຳຖາມທຳອິດ'),
      line('ກ. ໜຶ່ງ', tab(), 'ຂ. ສອງ'),
      line('ຄ. ສາມ', tab(), new TextRun({ text: 'ງ. ສີ່', underline: {} })),
      line('ພາກ II'),
      line('1. ຄຳຖາມທີສອງ'),
      line('ກ. ໜຶ່ງ', tab(), 'ຂ. ສອງ'),
    ]);

    const exam = await parseExamDocx(file);

    expect(exam.optionLabelStyle).toBe('lao');
    expect(exam.preamble).toBe('ພາກ I');
    expect(exam.questions.map((q) => q.section)).toEqual([null, 'ພາກ II']);
    expect(exam.questions[0].correctIndex).toBe(3);
    expect(exam.questions[1].options.map((o) => o.text)).toEqual(['ໜຶ່ງ', 'ສອງ']);
  });

  it('reads Word auto-numbering as question numbers and option letters', async () => {
    const file = await build(
      [
        new Paragraph({
          numbering: { reference: 'questions', level: 0 },
          children: [new TextRun('ຄຳຖາມ')],
        }),
        new Paragraph({
          numbering: { reference: 'answers', level: 0 },
          children: [new TextRun('ຜິດ')],
        }),
        new Paragraph({
          numbering: { reference: 'answers', level: 0 },
          children: [new TextRun({ text: 'ຖືກ', bold: true })],
        }),
        new Paragraph({
          numbering: { reference: 'answers', level: 0 },
          children: [new TextRun('ຜິດອີກ')],
        }),
      ],
      {
        config: [
          {
            reference: 'questions',
            levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.' }],
          },
          {
            reference: 'answers',
            levels: [{ level: 0, format: LevelFormat.UPPER_LETTER, text: '%1.' }],
          },
        ],
      },
    );

    const exam = await parseExamDocx(file);

    expect(exam.questions).toHaveLength(1);
    expect(exam.questions[0].text).toBe('ຄຳຖາມ');
    expect(exam.questions[0].options.map((o) => o.text)).toEqual(['ຜິດ', 'ຖືກ', 'ຜິດອີກ']);
    expect(exam.questions[0].correctIndex).toBe(1);
  });

  it('reads options laid out in a table, and locks a question whose option says ຖືກທຸກຂໍ້', async () => {
    const cell = (...runs: (string | TextRun)[]) => new TableCell({ children: [line(...runs)] });
    const file = await build([
      line('1. ຄຳຖາມ'),
      new Table({
        rows: [
          new TableRow({ children: [cell('A. ໜຶ່ງ'), cell('B. ສອງ')] }),
          new TableRow({ children: [cell('C. ສາມ'), cell(bold('D. ຖືກທຸກຂໍ້'))] }),
        ],
      }),
    ]);

    const exam = await parseExamDocx(file);

    expect(exam.questions[0].options.map((o) => o.text)).toEqual([
      'ໜຶ່ງ',
      'ສອງ',
      'ສາມ',
      'ຖືກທຸກຂໍ້',
    ]);
    expect(exam.questions[0].correctIndex).toBe(3);
    expect(exam.questions[0].lockOptions).toBe(true);
  });

  it('attaches a picture on its own line to the stem, or to the last option', async () => {
    const picture = () =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: 'png',
            data: PNG,
            transformation: { width: 120, height: 80 },
          }),
        ],
      });
    const file = await build([
      line('1. ຮູບໃດ?'),
      picture(),
      line('A. ໜຶ່ງ'),
      line(bold('B. ສອງ')),
      picture(),
    ]);

    const exam = await parseExamDocx(file);

    expect(exam.images).toHaveLength(2);
    expect(exam.images[0].mimeType).toBe('image/png');
    // 120px at 96dpi is 90pt.
    expect(exam.images[0].widthPt).toBe(90);
    expect(exam.images[0].heightPt).toBe(60);
    expect(exam.images[0].descentPt).toBe(0);
    const [question] = exam.questions;
    expect(question.imageIds).toEqual([exam.images[0].id]);
    expect(question.options[1].imageIds).toEqual([exam.images[1].id]);
    expect(question.correctIndex).toBe(1);
    // Each picture is written into its text where it stood, so a picture
    // inside a sentence prints inside the sentence.
    expect(question.text).toBe('ຮູບໃດ?\n⟦1⟧');
    expect(question.options[1].text).toBe('ສອງ\n⟦1⟧');
  });

  it('keeps an equation picture in the middle of its sentence', async () => {
    const picture = () =>
      new ImageRun({ type: 'png', data: PNG, transformation: { width: 40, height: 16 } });
    const file = await build([
      new Paragraph({
        children: [
          new TextRun('1. ໃຫ້ '),
          picture(),
          new TextRun(' ແລະ '),
          picture(),
          new TextRun(' ແມ່ນ?'),
        ],
      }),
      new Paragraph({ children: [new TextRun('A. '), picture(), tab(), new TextRun('B. ໜຶ່ງ')] }),
    ]);
    const exam = await parseExamDocx(file);
    const [question] = exam.questions;
    expect(question.text).toBe('ໃຫ້ ⟦1⟧ ແລະ ⟦2⟧ ແມ່ນ?');
    expect(question.imageIds).toHaveLength(2);
    expect(question.options.map((o) => o.text)).toEqual(['⟦1⟧', 'ໜຶ່ງ']);
    expect(question.options[0].imageIds).toHaveLength(1);
  });

  it('draws a WMF equation into a PNG when LibreOffice is there, and warns when it is not', async () => {
    const { metafileConverterPath } = await import('./print/metafile-converter');
    // The smallest WMF that draws anything: a placeable header, a rectangle.
    const wmf = Buffer.from(
      'd7cdc69a0000000000006400640000000000000001000900000300180000000000030000000000' +
        '2b0400000004000000000000000500000006010000000000050000000901000000000c02640064' +
        '00000000000000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000',
      'hex',
    );
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<w:body><w:p><w:r><w:t>1. ໃຫ້ </w:t></w:r><w:r><w:rPr><w:position w:val="-7"/></w:rPr>' +
        '<w:object><v:shape style="width:30pt;height:12pt">' +
        '<v:imagedata r:id="rId9"/></v:shape></w:object></w:r><w:r><w:t> ແມ່ນ?</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>A. ໜຶ່ງ</w:t></w:r></w:p><w:p><w:r><w:t>B. ສອງ</w:t></w:r></w:p></w:body></w:document>',
    );
    zip.file(
      'word/_rels/document.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/></Relationships>',
    );
    zip.file('word/media/image1.wmf', wmf);
    const exam = await parseExamDocx(await zip.generateAsync({ type: 'nodebuffer' }));

    expect(exam.questions[0].text).toBe('ໃຫ້ ⟦1⟧ ແມ່ນ?');
    if (metafileConverterPath()) {
      expect(exam.images).toHaveLength(1);
      expect(exam.images[0].mimeType).toBe('image/png');
      // MathType lowers the run 3.5 pt so the equation's baseline meets the words'.
      expect(exam.images[0].descentPt).toBe(3.5);
      expect(exam.warnings.filter((w) => w.code === 'unsupportedImage')).toHaveLength(0);
    } else {
      expect(exam.images).toHaveLength(0);
      expect(exam.warnings).toContainEqual({
        code: 'unsupportedImage',
        question: null,
        detail: 'wmf',
      });
    }
  }, 60000);

  it('warns about a letter out of sequence at the head of a line and about a file with no questions', async () => {
    const skipped = await parseExamDocx(
      await build([line('1. ຄຳຖາມ'), line('A. ໜຶ່ງ'), line('C. ສາມ'), line('B. ສອງ')]),
    );
    // Both lines are kept as options — losing one would lose the teacher's
    // work — and each mis-lettered head of line is reported.
    expect(skipped.warnings).toEqual([
      { code: 'optionSequence', question: 1, detail: 'C' },
      { code: 'optionSequence', question: 1, detail: 'B' },
      { code: 'noAnswer', question: 1 },
    ]);
    expect(skipped.questions[0].options.map((o) => o.text)).toEqual(['ໜຶ່ງ', 'ສາມ', 'ສອງ']);

    const empty = await parseExamDocx(await build([line('ບໍ່ມີຫຍັງ')]));
    expect(empty.questions).toEqual([]);
    expect(empty.warnings).toEqual([{ code: 'noQuestions', question: null }]);
  });

  it('reads Word equations as TeX between dollars, and two markers with nothing between them', async () => {
    const math = (...children: (MathRun | MathFraction | MathSuperScript)[]) =>
      new WordMath({ children });
    const file = await build([
      line('1. ໃຫ້ '),
      new Paragraph({
        children: [
          new TextRun('1. ໃຫ້ '),
          math(new MathRun('A={1,2,3}')),
          new TextRun(' ແລ້ວ '),
          math(
            new MathFraction({ numerator: [new MathRun('1')], denominator: [new MathRun('2')] }),
          ),
          new TextRun(' ແມ່ນ?'),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun('ກ. '),
          math(
            new MathSuperScript({ children: [new MathRun('x')], superScript: [new MathRun('2')] }),
          ),
          tab(),
          new TextRun('ຂ. '),
          math(new MathRun('A∪B')),
        ],
      }),
      line('ຄ. ໜຶ່ງ', tab(), 'ງ. ສອງ'),
    ]);

    const exam = await parseExamDocx(file);

    const question = exam.questions[exam.questions.length - 1];
    expect(question.text).toBe('ໃຫ້ $A=\\{1,2,3\\}$ ແລ້ວ $\\frac{1}{2}$ ແມ່ນ?');
    expect(question.options.map((o) => o.text)).toEqual(['$x^2$', '$A\\cup B$', 'ໜຶ່ງ', 'ສອງ']);
    expect(exam.warnings.filter((w) => w.code === 'mathInvalid')).toEqual([]);
  });

  it('keeps TeX the teacher wrote, drops MathType’s comment lines, and warns about bad TeX', async () => {
    const file = await build([
      // MathType → Convert Equations → TeX, with "include MathType data" on:
      // the sentence is broken across paragraphs by the comment lines.
      line('1. ເມື່ອຂະຫຍາຍ % MathType!MTEF!2!1!+-'),
      line('% feaagKart1ev2aaatCvAUfeBSjuyZL2yd9gzLbvyNv2CaerbuLwBLn'),
      line('% da9maakaaabaGaaGynaaWcbeaaaaa!3A6B!'),
      line('\\[ {\\left( {a + b} \\right)^2} \\] ກົງກັບເທົ່າໃດ?'),
      line('A. $a^2+2ab+b^2$', tab(), bold('B. $a^2-2ab+b^2$')),
      line('C. \\( a^2+b^2 \\)', tab(), 'D. $\\frac{a}{b$ ບໍ່ຖືກ'),
    ]);

    const exam = await parseExamDocx(file);

    expect(exam.questions).toHaveLength(1);
    const [question] = exam.questions;
    expect(question.text).toBe('ເມື່ອຂະຫຍາຍ $${\\left( {a + b} \\right)^2}$$ ກົງກັບເທົ່າໃດ?');
    expect(question.options.map((o) => o.text)).toEqual([
      '$a^2+2ab+b^2$',
      '$a^2-2ab+b^2$',
      '$a^2+b^2$',
      '$\\frac{a}{b$ ບໍ່ຖືກ',
    ]);
    expect(question.correctIndex).toBe(1);
    expect(exam.warnings).toEqual([{ code: 'mathInvalid', question: 1, detail: '\\frac{a}{b' }]);
  });

  it('gives an option the words of the paragraph after its bare letter', async () => {
    const cell = (...runs: (string | TextRun)[]) => new TableCell({ children: [line(...runs)] });
    const file = await build([
      line('1. ຄຳຖາມ'),
      new Table({
        rows: [
          new TableRow({ children: [cell('A.'), cell('ໜຶ່ງ'), cell('B.'), cell(bold('ສອງ'))] }),
        ],
      }),
    ]);
    const exam = await parseExamDocx(file);
    expect(exam.questions[0].options.map((o) => o.text)).toEqual(['ໜຶ່ງ', 'ສອງ']);
    expect(exam.questions[0].correctIndex).toBe(1);
  });

  it('rejects a zip that is not a Word document', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('hello.txt', 'not word');
    await expect(parseExamDocx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      /not a Word document/,
    );
  });
});
