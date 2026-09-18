import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Math as DocxMath,
  Packer,
  PageBreak,
  Paragraph,
  TabStopType,
  TextRun,
} from 'docx';
import { IMAGE_TOKEN } from '../docx-exam.parser';
import { splitMath } from '../math/latex-text';
import { texToDocxMath } from '../math/mathml-to-docx';
import { Variant } from '../variants';
import { OPTION_LETTERS, PrintImage, PrintOption, PrintPaper } from './exam-paper.renderer';

/**
 * Writes the sets back out as a Word file, for the teacher who wants to touch
 * the layout up before printing.
 *
 * The typography follows the same house style as the PDF — Phetsarath OT
 * for Lao, Times New Roman for figures — by naming the fonts; Word on the
 * teacher's machine supplies them. The layout is the same too: number and
 * stem, options two to a line when short, one per line otherwise, pictures
 * where the teacher had them, and each `$…$` formula as a Word equation the
 * teacher can edit. It will not be the teacher's original file
 * with the questions moved — Word's own layout does not survive the round
 * trip — and it is not meant to be.
 */

const LAO_FONT = 'Phetsarath OT';
const LATIN_FONT = 'Times New Roman';
const BODY_HALF_POINTS = 22;
const LAO_PATTERN = /[຀-໿]/;

/** Word wants pixels at 96 dpi; the parser kept points. */
const PX_PER_PT = 96 / 72;
const CONTENT_WIDTH_PT = 595 - 2 * 60;
const MAX_IMAGE_HEIGHT_PT = 300;
/** TeX that stacks — a fraction, a big operator, a matrix — and wants a line of its own. */
const TALL_TEX = /\\(frac|dfrac|binom|sum|prod|int|begin)\b/;

@Injectable()
export class ExamPaperDocxWriter {
  async writeSets(paper: PrintPaper, labels: string[]): Promise<Buffer> {
    const variants = paper.variants.filter((variant) => labels.includes(variant.label));
    const letters = OPTION_LETTERS[paper.optionLabelStyle];

    const children = variants.flatMap((variant, index) => [
      ...(index > 0 ? [new Paragraph({ children: [new PageBreak()] })] : []),
      ...this.header(paper, variant.label),
      ...this.questions(paper, variant, letters),
    ]);

    const document = new Document({
      creator: 'VPSI School Management',
      title: paper.title,
      styles: {
        default: {
          document: { run: { font: LAO_FONT, size: BODY_HALF_POINTS } },
        },
      },
      sections: [
        {
          properties: {
            page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } },
          },
          children,
        },
      ],
    });

    return Packer.toBuffer(document);
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  /** Same rule as the PDF: the teacher's header as written, or ours when there is none. */
  private header(paper: PrintPaper, label: string): Paragraph[] {
    const lines = paper.preamble.trim()
      ? paper.preamble.split('\n').filter((line) => line.trim())
      : [paper.schoolNameLo, paper.title];
    const blocks: Paragraph[] = lines.map(
      (line, index) =>
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
          children: [
            ...this.runs(line, { bold: !paper.preamble.trim() }),
            ...(index === 0
              ? [
                  new TextRun({ children: ['\t'] }),
                  ...this.runs(`ຊຸດ ${label}`, { bold: true, size: 28 }),
                ]
              : []),
          ],
        }),
    );
    blocks.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } },
        spacing: { after: 160 },
        children: [],
      }),
    );
    return blocks;
  }

  private questions(paper: PrintPaper, variant: Variant, letters: string[]): Paragraph[] {
    const blocks: Paragraph[] = [];
    let lastSection: string | null | undefined;

    variant.questionOrder.forEach((original, position) => {
      const question = paper.questions[original];
      if (question.section !== lastSection && question.section) {
        blocks.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 80 },
            children: this.runs(question.section, { bold: true }),
          }),
        );
      }
      lastSection = question.section;

      const stem = this.runsWithImages(question.text, question.images);
      blocks.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: 100 },
          indent: { left: 400, hanging: 400 },
          children: [...this.runs(`${position + 1}. `, { bold: true }), ...stem.runs],
        }),
      );
      for (const image of stem.unplaced) blocks.push(this.picture(image, 400));

      const options = variant.optionOrders[position].map((originalIndex, printed) => ({
        letter: letters[printed],
        option: question.options[originalIndex],
      }));

      if (this.twoUp(options.map((o) => o.option))) {
        for (let i = 0; i < options.length; i += 2) {
          const pair = options.slice(i, i + 2);
          blocks.push(
            new Paragraph({
              indent: { left: 400 },
              tabStops: [{ type: TabStopType.LEFT, position: 4800 }],
              children: pair.flatMap(({ letter, option }, j) => [
                ...(j > 0 ? [new TextRun({ children: ['\t'] })] : []),
                ...this.runs(`${letter}. `),
                ...this.runsWithImages(option.text, option.images).runs,
              ]),
            }),
          );
        }
        return;
      }

      for (const { letter, option } of options) {
        const body = this.runsWithImages(option.text, option.images);
        blocks.push(
          new Paragraph({
            indent: { left: 800, hanging: 400 },
            children: [...this.runs(`${letter}. `), ...body.runs],
          }),
        );
        for (const image of body.unplaced) blocks.push(this.picture(image, 800));
      }
    });

    return blocks;
  }

  /**
   * Same rule as the PDF: short options, with at most a small picture or a
   * one-line formula in the line, share a line.
   */
  private twoUp(options: PrintOption[]): boolean {
    return options.every((option) => {
      const parts = splitMath(option.text.replace(IMAGE_TOKEN, ''));
      const tall = parts.some(
        (part) => part.kind === 'math' && (part.display || TALL_TEX.test(part.tex)),
      );
      const length = parts.reduce(
        (sum, part) => sum + (part.kind === 'text' ? part.text.length : 4),
        0,
      );
      return (
        !tall &&
        length <= 28 &&
        option.images.every((image) => image.heightPt <= 26) &&
        option.images.length <= (option.text.match(IMAGE_TOKEN) ?? []).length
      );
    });
  }

  /** Text with its pictures set in at their `⟦n⟧` tokens; the rest go below. */
  private runsWithImages(
    text: string,
    images: PrintImage[],
  ): { runs: (TextRun | ImageRun | DocxMath)[]; unplaced: PrintImage[] } {
    const runs: (TextRun | ImageRun | DocxMath)[] = [];
    const placed = new Set<number>();
    let last = 0;
    for (const match of text.matchAll(IMAGE_TOKEN)) {
      const index = Number(match[1]) - 1;
      if (match.index! > last) runs.push(...this.runsWithMath(text.slice(last, match.index)));
      const image = images[index];
      if (image) {
        runs.push(this.imageRun(image));
        placed.add(index);
      }
      last = match.index! + match[0].length;
    }
    if (last < text.length) runs.push(...this.runsWithMath(text.slice(last)));
    return { runs, unplaced: images.filter((_, i) => !placed.has(i)) };
  }

  /** Words as runs, each `$…$` formula as a Word equation — or as its TeX when it does not parse. */
  private runsWithMath(text: string): (TextRun | DocxMath)[] {
    return splitMath(text).flatMap((part) => {
      if (part.kind === 'text') return this.runs(part.text);
      return texToDocxMath(part.tex, part.display) ?? this.runs(part.source);
    });
  }

  private imageRun(image: PrintImage): ImageRun {
    const scale = Math.min(
      1,
      CONTENT_WIDTH_PT / image.widthPt,
      MAX_IMAGE_HEIGHT_PT / image.heightPt,
    );
    return new ImageRun({
      type: image.mimeType === 'image/png' ? 'png' : 'jpg',
      data: image.buffer,
      transformation: {
        width: Math.round(image.widthPt * scale * PX_PER_PT),
        height: Math.round(image.heightPt * scale * PX_PER_PT),
      },
    });
  }

  private picture(image: PrintImage, indentTwips: number): Paragraph {
    return new Paragraph({ indent: { left: indentTwips }, children: [this.imageRun(image)] });
  }

  /**
   * One run per script, so a figure inside a Lao sentence is set in Times as
   * the house style asks, and a line break in the source stays a line break.
   */
  private runs(text: string, style: { bold?: boolean; size?: number } = {}): TextRun[] {
    const runs: TextRun[] = [];
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
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
      for (const character of line) {
        // A space stays in the run it follows; only a change of script splits.
        const isLao: boolean = /\s/.test(character)
          ? (currentIsLao ?? true)
          : LAO_PATTERN.test(character);
        if (currentIsLao !== null && isLao !== currentIsLao) flush();
        currentIsLao = isLao;
        current += character;
      }
      flush();
      if (lineIndex < lines.length - 1) runs.push(new TextRun({ break: 1 }));
    });
    return runs;
  }
}
