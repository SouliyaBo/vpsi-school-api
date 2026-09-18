import PDFDocument from 'pdfkit';
import { resolveOfficialLaoFonts } from 'src/modules/reports/pdf/font-resolver';
import SVGtoPDF from 'svg-to-pdfkit';
import { splitMath } from '../math/latex-text';
import { texToSvg, TypesetMath } from '../math/mathjax';

/**
 * Sets mixed Lao and Latin text on one baseline, in the office's house style:
 * Lao in Phetsarath OT, every figure and Latin letter in Times.
 *
 * PDFKit's own `text()` cannot do this — it wraps each font run on its own,
 * so a line that changes face mid-way comes apart — and the letter renderer's
 * typesetter is welded to its letterhead. This one is the minimum an exam
 * paper needs: measure a paragraph, draw it, and say how tall it was, so a
 * question can be kept on one page.
 */

const LAO = 'exam-lao';
const LAO_BOLD = 'exam-lao-bold';
const LATIN = 'Times-Roman';
const LATIN_BOLD = 'Times-Bold';

const LAO_PATTERN = /[຀-໿]/;

export interface InlineImage {
  buffer: Buffer;
  /** Points, already scaled to what it should print at. */
  width: number;
  height: number;
  /**
   * How far its bottom edge sits below the text baseline, in points. An
   * equation is lowered so its own baseline meets the words'; a picture with
   * no say in the matter is centred on the text instead.
   */
  descent?: number;
}

/** A stretch of text in one weight — or a picture, or a formula, set into the line. */
export interface Span {
  text: string;
  bold?: boolean;
  image?: InlineImage;
  /** A formula MathJax drew, as vector art on the baseline. */
  math?: TypesetMath;
}

interface Atom {
  text: string;
  font: string;
  width: number;
  isSpace: boolean;
  /** A `\n` in the source: the line ends here whatever its width. */
  isBreak: boolean;
  /** An equation or figure sitting in the line, on the baseline with the words. */
  image?: InlineImage;
  math?: TypesetMath;
}

export interface Line {
  atoms: Atom[];
  width: number;
  /** The text's leading, or more if a picture in the line needs it. */
  height: number;
  /** Where the baseline sits below the line's top. */
  baseline: number;
}

export type Align = 'left' | 'center' | 'right';

export class Typesetter {
  constructor(private readonly doc: PDFKit.PDFDocument) {
    const fonts = resolveOfficialLaoFonts();
    doc.registerFont(LAO, fonts.regular);
    doc.registerFont(LAO_BOLD, fonts.bold);
  }

  /**
   * Leading from the Lao face whatever is selected: Lao stacks a vowel and a
   * tone mark above the consonant and needs more room than Times reports.
   */
  lineHeight(size: number, leading = 1.3): number {
    this.doc.font(LAO).fontSize(size);
    return this.doc.currentLineHeight(true) * leading;
  }

  /**
   * Where the baseline of a line sits below its top — the Lao face's ascent.
   *
   * Every atom of a line is drawn on this one baseline. Aligning tops instead
   * (PDFKit's default) lifts each Times figure above the Lao around it, since
   * the two faces reach different heights over the baseline.
   */
  private ascent(size: number): number {
    this.doc.font(LAO).fontSize(size);
    const font = (this.doc as unknown as { _font?: { ascender?: number } })._font;
    return ((font?.ascender ?? 800) / 1000) * size;
  }

  /** Width of one line of spans, unwrapped. */
  widthOf(spans: Span[], size: number): number {
    return this.atoms(spans, size).reduce((sum, atom) => sum + atom.width, 0);
  }

  /** How tall `spans` are when wrapped to `width`. */
  measure(spans: Span[], width: number, size: number, leading?: number): number {
    return this.layout(spans, width, size, leading).reduce((sum, line) => sum + line.height, 0);
  }

  /** Draws `spans` wrapped to `width` from the top-left (`x`, `y`); returns the height used. */
  draw(
    spans: Span[],
    x: number,
    y: number,
    width: number,
    size: number,
    options: { align?: Align; leading?: number } = {},
  ): number {
    const lines = this.layout(spans, width, size, options.leading);
    const align = options.align ?? 'left';

    let top = y;
    for (const line of lines) {
      const offset =
        align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0;
      let cursor = x + Math.max(0, offset);
      const baseline = top + line.baseline;
      for (const atom of line.atoms) {
        if (atom.math) {
          SVGtoPDF(
            this.doc,
            atom.math.svg,
            cursor,
            baseline + atom.math.descent - atom.math.height,
            {
              assumePt: true,
            },
          );
        } else if (atom.image) {
          const descent = this.descentOf(atom.image, size);
          this.doc.image(atom.image.buffer, cursor, baseline + descent - atom.image.height, {
            width: atom.image.width,
            height: atom.image.height,
          });
        } else if (!atom.isSpace && !atom.isBreak) {
          this.doc.font(atom.font).fontSize(size);
          this.doc.text(atom.text, cursor, baseline, { lineBreak: false, baseline: 'alphabetic' });
        }
        cursor += atom.width;
      }
      top += line.height;
    }

    return top - y;
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  /**
   * Where a picture's bottom goes relative to the baseline: where the source
   * said, or — when it did not — wherever centres the picture on the text.
   */
  private descentOf(image: InlineImage, size: number): number {
    if (image.descent !== undefined) return image.descent;
    const textHeight = this.lineHeight(size);
    const middle = this.ascent(size) - textHeight / 2;
    return image.height / 2 - middle;
  }

  private fontFor(isLao: boolean, bold: boolean): string {
    if (isLao) return bold ? LAO_BOLD : LAO;
    return bold ? LATIN_BOLD : LATIN;
  }

  private atoms(spans: Span[], size: number): Atom[] {
    const atoms: Atom[] = [];
    for (const span of spans) {
      if (span.math) {
        atoms.push({
          text: '',
          font: LATIN,
          width: span.math.width,
          isSpace: false,
          isBreak: false,
          math: span.math,
        });
        continue;
      }
      if (span.image) {
        atoms.push({
          text: '',
          font: LATIN,
          width: span.image.width,
          isSpace: false,
          isBreak: false,
          image: span.image,
        });
        continue;
      }
      const bold = span.bold ?? false;
      for (const token of span.text.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) {
          // Each newline is a hard break; the rest of the whitespace is one space.
          const breaks = token.split('').filter((c) => c === '\n').length;
          for (let i = 0; i < breaks; i += 1) {
            atoms.push({ text: '', font: LATIN, width: 0, isSpace: false, isBreak: true });
          }
          if (breaks === 0) {
            this.doc.font(LATIN).fontSize(size);
            atoms.push({
              text: ' ',
              font: LATIN,
              width: this.doc.widthOfString(' '),
              isSpace: true,
              isBreak: false,
            });
          }
          continue;
        }
        for (const run of segmentByScript(token)) {
          const font = this.fontFor(run.isLao, bold);
          this.doc.font(font).fontSize(size);
          atoms.push({
            text: run.text,
            font,
            width: this.doc.widthOfString(run.text),
            isSpace: false,
            isBreak: false,
          });
        }
      }
    }
    return atoms;
  }

  /**
   * Greedy line breaking at spaces and hard breaks. A Lao phrase is written
   * without spaces, so an atom wider than the measure is split by character
   * rather than run off the page.
   */
  private layout(spans: Span[], width: number, size: number, leading?: number): Line[] {
    const lines: Line[] = [];
    const textHeight = this.lineHeight(size, leading);
    const ascent = this.ascent(size);
    let current: Atom[] = [];
    let currentWidth = 0;

    const flush = () => {
      while (current.length > 0 && current[current.length - 1].isSpace) {
        currentWidth -= current.pop()!.width;
      }
      // The words claim their leading around the baseline; a picture that
      // reaches beyond it above or below makes the line taller on that side.
      let above = ascent;
      let below = textHeight - ascent;
      for (const atom of current) {
        if (atom.math) {
          above = Math.max(above, atom.math.height - atom.math.descent + 1);
          below = Math.max(below, atom.math.descent + 1);
        } else if (atom.image) {
          const descent = this.descentOf(atom.image, size);
          above = Math.max(above, atom.image.height - descent + 1);
          below = Math.max(below, descent + 1);
        }
      }
      lines.push({ atoms: current, width: currentWidth, height: above + below, baseline: above });
      current = [];
      currentWidth = 0;
    };

    for (const atom of this.atoms(spans, size)) {
      if (atom.isBreak) {
        flush();
        continue;
      }
      if (atom.isSpace && current.length === 0) continue;
      if (currentWidth + atom.width <= width || current.length === 0) {
        if (atom.width > width && !atom.image && !atom.math) {
          for (const piece of this.split(atom, width, size)) {
            if (currentWidth + piece.width > width && current.length > 0) flush();
            current.push(piece);
            currentWidth += piece.width;
          }
          continue;
        }
        current.push(atom);
        currentWidth += atom.width;
        continue;
      }
      flush();
      if (!atom.isSpace) {
        current.push(atom);
        currentWidth += atom.width;
      }
    }
    if (current.length > 0 || lines.length === 0) flush();
    return lines;
  }

  private split(atom: Atom, width: number, size: number): Atom[] {
    this.doc.font(atom.font).fontSize(size);
    const pieces: Atom[] = [];
    let text = '';
    for (const character of [...atom.text]) {
      const candidate = text + character;
      if (text && this.doc.widthOfString(candidate) > width) {
        pieces.push({ ...atom, text, width: this.doc.widthOfString(text) });
        text = character;
      } else {
        text = candidate;
      }
    }
    if (text) pieces.push({ ...atom, text, width: this.doc.widthOfString(text) });
    return pieces;
  }
}

/**
 * Text with its `$…$` formulas typeset at `size`: the words as spans, each
 * formula as a math span. A formula MathJax cannot read stays as the TeX it
 * was written as, so the teacher sees what to fix.
 */
export function spansWithMath(text: string, size: number, style: { bold?: boolean } = {}): Span[] {
  return splitMath(text).map((part) => {
    if (part.kind === 'text') return { text: part.text, ...style };
    // Display style throughout: a fraction at full size, limits over the
    // sum — the way MathType sets an equation in a sentence, which is the
    // look the school is used to.
    const math = texToSvg(part.tex, size, true);
    return math ? { text: '', math } : { text: part.source, ...style };
  });
}

/** Runs of one script: the Lao block goes to Phetsarath, everything else to Times. */
function segmentByScript(text: string): { text: string; isLao: boolean }[] {
  const runs: { text: string; isLao: boolean }[] = [];
  for (const character of text) {
    const isLao = LAO_PATTERN.test(character);
    const last = runs[runs.length - 1];
    if (last && last.isLao === isLao) last.text += character;
    else runs.push({ text: character, isLao });
  }
  return runs;
}

/** A document with the page and metadata every printout of the module shares. */
export function openDocument(title: string): {
  doc: PDFKit.PDFDocument;
  finished: Promise<Buffer>;
} {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 48, bottom: 52, left: 54, right: 54 },
    bufferPages: true,
    info: { Title: title, Creator: 'VPSI School Management' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, finished };
}

export function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

export function contentBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}
