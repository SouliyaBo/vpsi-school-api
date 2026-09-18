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
