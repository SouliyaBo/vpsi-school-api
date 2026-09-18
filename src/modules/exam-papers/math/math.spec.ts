import { DOMParser } from '@xmldom/xmldom';
import { Packer, Document, Paragraph } from 'docx';
import JSZip from 'jszip';
import { normaliseMathDelimiters, splitMath, stripTexComments } from './latex-text';
import { isValidTex, texToMathML, texToSvg } from './mathjax';
import { texToDocxMath } from './mathml-to-docx';
import { ommlToLatex } from './omml-to-latex';

describe('splitMath', () => {
  it('finds inline and display formulas in order and leaves the words alone', () => {
    expect(splitMath('ໃຫ້ $x=1$ ແລະ $$y=2$$ ແລ້ວ')).toEqual([
      { kind: 'text', text: 'ໃຫ້ ' },
      { kind: 'math', tex: 'x=1', display: false, source: '$x=1$' },
      { kind: 'text', text: ' ແລະ ' },
      { kind: 'math', tex: 'y=2', display: true, source: '$$y=2$$' },
      { kind: 'text', text: ' ແລ້ວ' },
    ]);
  });

  it('does not pair dollars across a line break, and is not thrown by an earlier call', () => {
    expect(splitMath('$5\nA. $6')).toEqual([{ kind: 'text', text: '$5\nA. $6' }]);
    expect(splitMath('$a$').length).toBe(1);
    expect(splitMath('$a$').length).toBe(1);
  });

  it('turns \\( \\) and \\[ \\] into the dollar forms', () => {
    expect(normaliseMathDelimiters('ໃຫ້ \\( x \\) ແລະ \\[ y^2 \\]')).toBe('ໃຫ້ $x$ ແລະ $$y^2$$');
  });
});

describe('stripTexComments', () => {
  it('drops MathType’s comment lines and says when the text ended in one', () => {
    expect(stripTexComments('1. ໃຫ້ % MathType!MTEF!2!1!+-\n% feaagKart1ev\n% !3A6B!')).toEqual({
      text: '1. ໃຫ້',
      endedInComment: true,
    });
    expect(stripTexComments('$x = \\sqrt 5 $ ແລ້ວ')).toEqual({
      text: '$x = \\sqrt 5 $ ແລ້ວ',
      endedInComment: false,
    });
  });

  it('leaves a percentage in a sentence alone', () => {
    expect(stripTexComments('ລາຄາຫຼຸດ 50% ຂອງ 200').text).toBe('ລາຄາຫຼຸດ 50% ຂອງ 200');
  });
});

describe('MathJax', () => {
  it('accepts good TeX and refuses bad', () => {
    expect(isValidTex('\\frac{a}{b}+\\sqrt{5}')).toBe(true);
    expect(isValidTex('\\frac{a}{b')).toBe(false);
    expect(isValidTex('\\nosuchmacro')).toBe(false);
  });

  it('draws a formula as vector art sized in points, on the baseline', () => {
    const math = texToSvg('x^2', 11)!;
    expect(math.svg.startsWith('<svg')).toBe(true);
    expect(math.svg).toMatch(/width="[\d.]+"/);
    expect(math.width).toBeGreaterThan(8);
    expect(math.width).toBeLessThan(16);
    expect(math.height).toBeGreaterThan(6);
    expect(math.descent).toBeGreaterThanOrEqual(0);
    // A fraction reaches below the baseline.
    expect(texToSvg('\\frac{1}{2}', 11, true)!.descent).toBeGreaterThan(3);
    expect(texToSvg('\\frac{1}{2', 11)).toBeNull();
  });

  it('gives the MathML the Word writer builds from', () => {
    expect(texToMathML('\\sqrt{5}')).toContain('<msqrt>');
  });
});

describe('ommlToLatex', () => {
  const NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
  const omml = (inner: string) =>
    new DOMParser().parseFromString(`<m:oMath ${NS}>${inner}</m:oMath>`, 'text/xml')
      .documentElement!;
  const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;

  it('spells a fraction, a root, scripts, brackets and a sum as TeX', () => {
    expect(
      ommlToLatex(
        omml(
          `${r('x=')}<m:f><m:num>${r('2')}<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r('10')}</m:e></m:rad></m:num><m:den>${r('4')}</m:den></m:f>` +
            `<m:sSup><m:e>${r('a')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>` +
            `<m:sSubSup><m:e>${r('x')}</m:e><m:sub>${r('i')}</m:sub><m:sup>${r('n+1')}</m:sup></m:sSubSup>` +
            `<m:d><m:e>${r('a+b')}</m:e></m:d>` +
            `<m:rad><m:deg>${r('3')}</m:deg><m:e>${r('x')}</m:e></m:rad>`,
        ),
      ),
    ).toBe('x=\\frac{2\\sqrt{10}}{4}a^2x_i^{n+1}\\left( a+b \\right)\\sqrt[3]{x}');
    expect(
      ommlToLatex(
        omml(
          `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r('n')}</m:sup><m:e>${r('i')}</m:e></m:nary>`,
        ),
      ),
    ).toBe('\\sum_{i=1}^n i');
  });

  it('spells operators and Greek letters as their macros, and a function by name', () => {
    expect(ommlToLatex(omml(r('α×β≤π')))).toBe('\\alpha \\times \\beta \\le \\pi');
    expect(
      ommlToLatex(omml(`<m:func><m:fName>${r('sin')}</m:fName><m:e>${r('x')}</m:e></m:func>`)),
    ).toBe('\\sin x');
  });

  it('keeps text runs as text', () => {
    expect(ommlToLatex(omml(`<m:r><m:rPr><m:nor/></m:rPr><m:t>ຖ້າ</m:t></m:r>${r('x')}`))).toBe(
      '\\text{ຖ້າ}x',
    );
  });

  it('produces TeX MathJax accepts', () => {
    const tex = ommlToLatex(
      omml(
        `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e><m:eqArr><m:e>${r('x=1')}</m:e><m:e>${r('y=2')}</m:e></m:eqArr></m:e></m:d>`,
      ),
    );
    expect(isValidTex(tex)).toBe(true);
  });
});

describe('texToDocxMath', () => {
  async function xmlOf(tex: string): Promise<string> {
    const math = texToDocxMath(tex)!;
    const buffer = await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph({ children: [math] })] }] }),
    );
    const zip = await JSZip.loadAsync(buffer);
    return (await zip.file('word/document.xml')!.async('string')).replace(/\s+/g, ' ');
  }

  it('builds Word equation parts: fraction, radical, scripts, brackets, sum', async () => {
    const xml = await xmlOf(
      '\\frac{a}{b} + \\sqrt{5} + x^2 + \\left(a+b\\right) + \\sum_{i=1}^{n} i',
    );
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<m:rad>');
    expect(xml).toContain('<m:sSup>');
    expect(xml).toContain('<m:d>');
    expect(xml).toContain('<m:nary>');
    expect(xml).toContain('<m:t>a</m:t>');
  });

  it('returns null for TeX that does not parse', () => {
    expect(texToDocxMath('\\frac{a}{b')).toBeNull();
  });
});
