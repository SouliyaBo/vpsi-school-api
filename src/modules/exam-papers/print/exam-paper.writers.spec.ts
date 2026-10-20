import JSZip from 'jszip';
import { drawVariants } from '../variants';
import { ExamPaperDocxWriter } from './exam-paper.docx.writer';
import { ExamPaperRenderer, PrintPaper } from './exam-paper.renderer';

/** A paper of formulas, as the parser would hand it over. */
function paper(): PrintPaper {
  const questions = [
    {
      section: null,
      text: 'ໃຫ້ $x=\\frac{2\\sqrt{10}}{4\\sqrt{5}}$ ແລ້ວ $x$ ເທົ່າກັບເທົ່າໃດ?',
      images: [],
      correctIndex: 0,
      options: [
        { text: '$\\frac{1}{2}$', images: [] },
        { text: '$\\sqrt{2}$', images: [] },
        { text: '$2\\sqrt{2}$', images: [] },
        { text: '$\\frac{a}{b$ ບໍ່ຖືກ', images: [] },
      ],
    },
  ];
  const variants = drawVariants(
    questions.map((q) => ({ section: null, optionCount: q.options.length, lockOptions: false })),
    { count: 1, shuffleOptions: false, seed: 1 },
  );
  return {
    title: 'ຄະນິດສາດ',
    schoolNameLo: 'ໂຮງຮຽນ',
    preamble: '',
    optionLabelStyle: 'latin',
    questions,
    variants,
  };
}

describe('formulas in the printouts', () => {
  it('prints a PDF with the formulas drawn as vector art', async () => {
    const renderer = new ExamPaperRenderer();
    const pdf = await renderer.renderSets(paper(), ['A']);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // No formula was turned into a picture: the same pictures (the crest)
    // as a paper of words alone.
    const words = paper();
    words.questions[0].text = 'ຄຳຖາມ';
    words.questions[0].options.forEach((option) => (option.text = 'ຄຳຕອບ'));
    const plain = await renderer.renderSets(words, ['A']);
    const pictures = (buffer: Buffer) =>
      (buffer.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
    expect(pictures(pdf)).toBe(pictures(plain));
    expect(pdf.length).toBeGreaterThan(plain.length);
  }, 30000);

  it('writes the formulas as Word equations, and bad TeX as typed', async () => {
    const docx = await new ExamPaperDocxWriter().writeSets(paper(), ['A']);
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<m:oMath>');
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<m:rad>');
    expect(xml).toContain('$\\frac{a}{b$');
    // A fraction is tall: the options are set one per line, not two up —
    // the only tab is the header's, before "ຊຸດ A".
    expect(xml.match(/<w:t[^>]*>\t<\/w:t>/g) ?? []).toHaveLength(1);
  });
});

describe('a ຄຳກອນ in the printouts', () => {
  /** The ມ.5 ພາສາລາວ question the office sent, 20 Oct 2026, marked as verse. */
  function proverb(): PrintPaper {
    const sheet = paper();
    sheet.questions[0].text =
      'ຄຳຜະຫຍາທີ່ວ່າ:\n⟪“ສາວບໍ່ມັກອ້າຍ | ບໍ່ມັກຕາຍກໍຕາມຊ່າງ\nບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ | ໃຫ້ຕາມກົ້ນແລ່ນນຳ”⟫\nໃຊ້ສິລະປະການປະດິດແຕ່ງແບບໃດ?';
    sheet.questions[0].options.forEach((option, i) => (option.text = `ຄຳຕອບ ${i + 1}`));
    return sheet;
  }

  it('writes each row as its own paragraph, the second ວັກ at one tab stop', async () => {
    const docx = await new ExamPaperDocxWriter().writeSets(proverb(), ['A']);
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    // No marker reaches the page.
    expect(xml).not.toMatch(/[⟪⟫|]/);
    const rows = xml
      .split('<w:p>')
      .filter((p) => p.includes('ສາວບໍ່ມັກອ້າຍ') || p.includes('ບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toContain('<w:tab w:val="left" w:pos="4200"/>');
      expect(row).toMatch(/<w:t[^>]*>\t<\/w:t>/);
    }
    expect(rows[0]).toContain('ບໍ່ມັກຕາຍກໍຕາມຊ່າງ');
    // The closing quote is its own Times run, by the house style.
    expect(rows[1]).toContain('ໃຫ້ຕາມກົ້ນແລ່ນນຳ');
  });

  it('prints the PDF without the markers', async () => {
    const pdf = await new ExamPaperRenderer().renderSets(proverb(), ['A']);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});

describe('ຄຳຖາມຕົວໜາ', () => {
  function words(boldQuestions?: boolean): PrintPaper {
    const sheet = paper();
    sheet.boldQuestions = boldQuestions;
    sheet.questions[0].text = 'ປະເທດລາວມີຊາຍແດນຮ່ວມກັບຈັກປະເທດ?';
    sheet.questions[0].options.forEach((option, i) => (option.text = `ຄຳຕອບ${'ກຂຄງ'[i]}`));
    return sheet;
  }
  /** The `<w:r>` that holds `text`, with its properties. */
  async function runOf(sheet: PrintPaper, text: string): Promise<string> {
    const docx = await new ExamPaperDocxWriter().writeSets(sheet, ['A']);
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    const run = xml.split('<w:r>').find((r) => r.includes(text));
    expect(run).toBeDefined();
    return run!;
  }

  it('sets every question bold by default, and leaves the options regular', async () => {
    expect(await runOf(words(), 'ປະເທດລາວມີຊາຍແດນ')).toContain('<w:b/>');
    expect(await runOf(words(), 'ຄຳຕອບກ')).not.toContain('<w:b/>');
  });

  it('prints the question regular when the teacher turns it off', async () => {
    expect(await runOf(words(false), 'ປະເທດລາວມີຊາຍແດນ')).not.toContain('<w:b/>');
  });
});

describe('ຂີດກ້ອງ in the printouts', () => {
  it('underlines the marked word in Word, and leaves no marker on the page', async () => {
    const sheet = paper();
    sheet.questions[0].text = 'ປະໂຫຍກ “ປ້າຂອງຂ້ອຍ[u]ພວມ[/u]ໄປຕະຫຼາດ” ສ່ວນທີ່ຂີດກ້ອງແມ່ນພາກສ່ວນໃດ?';
    const docx = await new ExamPaperDocxWriter().writeSets(sheet, ['A']);
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    expect(xml).not.toContain('[u]');
    const runs = xml.split('<w:r>');
    expect(runs.find((r) => r.includes('>ພວມ<'))).toContain('<w:u w:val="single"/>');
    expect(runs.find((r) => r.includes('ໄປຕະຫຼາດ'))).not.toContain('<w:u ');
  });

  it('prints the PDF', async () => {
    const sheet = paper();
    sheet.questions[0].text = 'ປ້າຂອງຂ້ອຍ[u]ພວມ[/u]ໄປຕະຫຼາດ';
    const pdf = await new ExamPaperRenderer().renderSets(sheet, ['A']);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});
