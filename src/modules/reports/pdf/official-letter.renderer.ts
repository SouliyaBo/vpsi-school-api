import { Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatLaoDateSlash } from 'src/common/utils/lao-date';
import { resolveOfficialLaoFonts } from './font-resolver';
import { resolveLetterheadImages } from './study-certificate-assets';

/** What every letter the office issues carries above its title. */
export interface LetterheadData {
  school: {
    /** `ພະແນກສຶກສາທິການ ແລະ ກີລາ` — the department above the school. */
    authorityLo: string;
    /** Short form used on the letterhead: `ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ`. */
    nameLo: string;
    provinceLo: string;
    phone: string;
  };
  /** Already formatted, e.g. `99/ວຈພທນ(ຄນຮ)`. */
  numberLo: string;
  issuedDate: Date;
}

// ── Fonts ───────────────────────────────────────────────────────────────────

const OFFICIAL = 'official';
const OFFICIAL_BOLD = 'official-bold';
const LATIN = 'Helvetica';
const LATIN_BOLD = 'Helvetica-Bold';

/**
 * What the official face is asked to set: Lao, digits, and the punctuation an
 * address or a reference number is made of.
 *
 * Phetsarath OT has no Latin alphabet, so a Latin word still goes to Helvetica —
 * but it does have digits, and setting `31/ສິງຫາ/2026` half in Phetsarath and
 * half in Helvetica is exactly the mismatch that makes a generated letter look
 * generated. When the resolver had to fall back to Noto Sans Lao, which carries
 * no digits at all, this narrows to the Lao block alone.
 */
const OFFICIAL_WITH_DIGITS = /[\u0E80-\u0EFF0-9\s.,:;/()\-]/;
const LAO_ONLY = /[\u0E80-\u0EFF]/;

/**
 * Where a Lao run may be broken across lines.
 *
 * Lao writes a whole clause without spaces, so the space is not where a line
 * may end — it is only where a clause does. ICU's dictionary breaker finds the
 * word boundaries inside the run; Node ships it for Lao, Thai and Khmer.
 */
const LAO_WORDS = new Intl.Segmenter('lo', { granularity: 'word' });

/**
 * Stands in for a value the register does not hold.
 *
 * A blank gap reads as a rendering fault and a parent will hand the letter
 * back; a dotted run reads as a field the office fills in by hand, which is
 * what actually happens — the school has no birthplace on file for all but one
 * of its pupils.
 */
export const BLANK = '……………………';

/** How many extra space-widths justification may add to one space. */
const MAX_SPACE_STRETCH = 2.5;

/**
 * A stretch of text with one weight. Assembled per paragraph.
 *
 * A no-break space (U+00A0) in `text` is set as an ordinary space but is not a
 * place the line may end — it ties a label to its value, so `ແຂວງ` never sits
 * at the end of one line with the province at the start of the next.
 */
export interface Span {
  text: string;
  bold?: boolean;
  /** Set as one piece: no line break anywhere inside, spaces included. */
  keep?: boolean;
}

/** One measured piece of a line, set in a single face. */
interface Atom {
  text: string;
  /** Set in the official Lao face rather than handed to Helvetica. */
  isOfficial: boolean;
  bold: boolean;
  width: number;
  /** Whitespace atoms are the only ones justification stretches. */
  isSpace: boolean;
  /** A line may not end just before this atom. */
  glueBefore: boolean;
}

/**
 * What the letters the office issues have in common: the national header, the
 * school block with its reference number, and a typesetter that can lay Lao and
 * Latin, regular and bold, on one baseline.
 *
 * Kept apart from `PdfRendererService` and its `ReportLayout` section language
 * on purpose. That language exists so an admin can reorder the blocks of a
 * report card; these documents have no reorderable blocks — each is one fixed
 * piece of official prose whose wording is not the school's to change, with
 * values dropped into the middle of sentences. Expressing them as sections
 * would have meant adding a general inline-placeholder mechanism to the layout
 * language and still hard-coding the sentences somewhere.
 *
 * Subclasses draw the title and body; everything above the title and the
 * machinery underneath is here so two letters cannot drift apart in their
 * letterhead.
 */
export abstract class OfficialLetterRenderer {
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Which characters the official face is asked to set. Decided per render
   * because it depends on the font that was actually found on this machine.
   */
  private officialPattern = OFFICIAL_WITH_DIGITS;

  /**
   * Opens a document with the fonts registered and the letterhead drawn, and
   * returns it together with the promise that resolves to its bytes.
   */
  protected async renderLetter(
    letterhead: LetterheadData,
    title: string,
    draw: (doc: PDFKit.PDFDocument) => void,
  ): Promise<Buffer> {
    const fonts = resolveOfficialLaoFonts();
    const images = resolveLetterheadImages();
    this.officialPattern = fonts.coversDigits ? OFFICIAL_WITH_DIGITS : LAO_ONLY;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 42, bottom: 48, left: 62, right: 62 },
      bufferPages: true,
      info: {
        Title: `${title} ${letterhead.numberLo}`,
        Author: letterhead.school.nameLo,
        Creator: 'VPSI School Management',
      },
    });

    doc.registerFont(OFFICIAL, fonts.regular);
    doc.registerFont(OFFICIAL_BOLD, fonts.bold);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', reject);
    });

    this.drawNationalHeader(doc, images.emblem);
    this.drawSchoolBlock(doc, letterhead, images.schoolLogo);
    draw(doc);

    doc.end();
    await finished;
    return Buffer.concat(chunks);
  }

  // ── Letterhead ────────────────────────────────────────────────────────────

  private drawNationalHeader(doc: PDFKit.PDFDocument, emblem: string | null): void {
    const { left } = doc.page.margins;
    const width = this.contentWidth(doc);

    if (emblem) {
      const size = 68;
      try {
        doc.image(emblem, left + (width - size) / 2, doc.y, { fit: [size, size] });
        doc.y += size + 8;
      } catch (error) {
        // A corrupt or non-PNG/JPEG file must not cost the office its letter.
        this.logger.warn(
          `The national emblem could not be drawn (${emblem}); continuing without it: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    doc.fontSize(13);
    this.line(doc, 'ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ', { align: 'center', bold: true });
    doc.fontSize(11.5);
    this.line(doc, 'ສັນຕິພາບ ເອກະລາດ ປະຊາທິປະໄຕ ເອກະພາບ ວັດທະນາຖາວອນ', {
      align: 'center',
      bold: true,
    });
    doc.y += 14;
  }

  /**
   * The school block on the left and the letter's own reference on the right.
   *
   * The two are drawn as independent columns from a shared top, not as rows:
   * they have different line counts, and a table would tie the phone number's
   * baseline to the date's for no reason.
   */
  private drawSchoolBlock(
    doc: PDFKit.PDFDocument,
    data: LetterheadData,
    logo: string | null,
  ): void {
    const { left } = doc.page.margins;
    const width = this.contentWidth(doc);
    const top = doc.y;

    doc.fontSize(10.5);
    this.line(doc, data.school.authorityLo, { x: left, width: width * 0.6 });

    const afterAuthority = doc.y + 2;
    const logoSize = 66;
    // The three school lines are indented past the logo **whether or not the
    // file is there**. The form reserves that space, so keeping it means a
    // letter printed before the logo was installed still lines up with one
    // printed after, instead of the whole block shifting left.
    const textX = left + logoSize + 12;

    if (logo) {
      try {
        doc.image(logo, left, afterAuthority, { fit: [logoSize, logoSize] });
      } catch (error) {
        this.logger.warn(
          `The school logo could not be drawn (${logo}); continuing without it: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    // Left column: school identity. All three lines are set at one weight —
    // the school's form does not emphasise its own name here, and the bold that
    // belongs on this page is reserved for the pupil's details in the body.
    let y = afterAuthority + 2;
    const leftWidth = width * 0.62 - (textX - left);
    doc.fontSize(11);
    y = this.line(doc, data.school.nameLo, { x: textX, y, width: leftWidth });
    y += 4;
    doc.fontSize(10.5);
    y = this.line(doc, `ແຂວງ ${data.school.provinceLo}`, { x: textX, y, width: leftWidth });
    y += 4;
    y = this.line(doc, `ໂທລະສັບ : ${data.school.phone}`, { x: textX, y, width: leftWidth });

    // Right column: reference number and date, set flush to the right margin.
    //
    // Right-aligned rather than started at a fixed column, because both lines
    // vary in length — the number grows from `99` to `1000` and the month is a
    // word — and a fixed start leaves them floating in the middle of the page.
    // Aligning to the margin is also what the school's own form does: the block
    // is what a clerk's eye goes to when filing the letter, so it sits on the
    // page edge.
    const rightWidth = width * 0.44;
    const rightX = left + width - rightWidth;
    let ry = afterAuthority + 14;
    doc.fontSize(10.5);
    ry = this.line(doc, `ເລກທີ ${data.numberLo}`, {
      x: rightX,
      y: ry,
      width: rightWidth,
      align: 'right',
    });
    ry += 4;
    ry = this.line(doc, `ລົງວັນທີ ${formatLaoDateSlash(data.issuedDate)}`, {
      x: rightX,
      y: ry,
      width: rightWidth,
      align: 'right',
    });

    doc.y = Math.max(y, ry, top) + 16;
    doc.x = left;
  }

  // ── Mixed-script text ─────────────────────────────────────────────────────

  protected contentWidth(doc: PDFKit.PDFDocument): number {
    return doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  /** A value for the body, or the dotted run that stands in for a missing one. */
  protected or(value: string | null | undefined): string {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : BLANK;
  }

  private fontFor(isOfficial: boolean, bold: boolean): string {
    if (isOfficial) return bold ? OFFICIAL_BOLD : OFFICIAL;
    return bold ? LATIN_BOLD : LATIN;
  }

  /**
   * Line height taken from the Lao face regardless of what is selected.
   *
   * Lao stacks a vowel above the consonant and a tone mark above that, so it
   * needs more leading than Helvetica reports. Measuring with whichever font
   * happens to be current gives Latin metrics on a mostly-Lao line and the marks
   * collide with the line above.
   */
  protected lineHeight(doc: PDFKit.PDFDocument): number {
    const previous = (doc as unknown as { _font?: { name?: string } })._font;
    doc.font(OFFICIAL);
    const height = doc.currentLineHeight(true);
    if (previous?.name) doc.font(previous.name);
    return height;
  }

  /**
   * Splits one token into runs by which face can set them.
   *
   * Not `segmentByScript` from the report card renderer: that one splits Lao
   * from everything-else, which was right when the Lao face had no digits and
   * everything else had to go to Helvetica. Here the official face sets the
   * digits too, so the boundary is "what Phetsarath covers", and it moves when
   * the resolver had to fall back.
   */
  private segment(text: string): { text: string; isOfficial: boolean }[] {
    const runs: { text: string; isOfficial: boolean }[] = [];

    for (const character of text) {
      const isOfficial = this.officialPattern.test(character);
      const last = runs[runs.length - 1];
      if (last && last.isOfficial === isOfficial) last.text += character;
      else runs.push({ text: character, isOfficial });
    }

    return runs;
  }

  /**
   * Splits one official-face run at Lao word boundaries.
   *
   * Only a boundary with Lao on both sides counts: the segmenter also breaks
   * `ມ.4` into `ມ`, `.`, `4` and `2026-2027` around its hyphen, and a class
   * label or a year split across two lines is worse than a long run.
   */
  private words(text: string): string[] {
    const words: string[] = [];
    for (const { segment } of LAO_WORDS.segment(text)) {
      const previous = words[words.length - 1];
      if (previous !== undefined && !(LAO_ONLY.test(previous) && LAO_ONLY.test(segment))) {
        words[words.length - 1] = previous + segment;
      } else {
        words.push(segment);
      }
    }
    return words;
  }

  /**
   * Splits spans into measured atoms, breaking at spaces, face changes and Lao
   * word boundaries.
   */
  private toAtoms(doc: PDFKit.PDFDocument, spans: Span[]): Atom[] {
    const atoms: Atom[] = [];

    // The atom after a no-break space is glued to it — across a span boundary
    // too, since a label ends one span and its value starts the next.
    let glueNext = false;

    for (const span of spans) {
      const bold = span.bold ?? false;
      const keep = span.keep ?? false;
      // Inside a kept span every atom is glued to the one before.
      let first = true;

      // Keep the separators: a line break has to fall *between* atoms, and the
      // space is what gets stretched when the line is justified. No-break
      // spaces are split out on their own so they can be told apart.
      for (const token of span.text.split(/([^\S\u00A0]+|\u00A0+)/)) {
        if (token.length === 0) continue;

        if (/^\s+$/.test(token)) {
          const noBreak = token.includes('\u00A0');
          // Spaces are set in the official face when it has one, so the rhythm
          // of a justified Lao line does not come from Helvetica's metrics.
          const isOfficial = this.officialPattern.test(' ');
          doc.font(this.fontFor(isOfficial, bold));
          atoms.push({
            text: ' ',
            isOfficial,
            bold,
            width: doc.widthOfString(' '),
            isSpace: true,
            glueBefore: noBreak || (keep && !first),
          });
          glueNext = noBreak;
          first = false;
          continue;
        }

        for (const run of this.segment(token)) {
          doc.font(this.fontFor(run.isOfficial, bold));
          const pieces = run.isOfficial ? this.words(run.text) : [run.text];
          for (const piece of pieces) {
            atoms.push({
              text: piece,
              isOfficial: run.isOfficial,
              bold,
              width: doc.widthOfString(piece),
              isSpace: false,
              glueBefore: glueNext || (keep && !first),
            });
            glueNext = false;
            first = false;
          }
        }
      }
    }

    return atoms;
  }

  /**
   * Breaks a Lao atom that is on its own too wide for a line.
   *
   * After word segmentation this only happens to a run the dictionary could
   * not break — a long transliterated name, say — and PDFKit, given no break
   * opportunity, would run it off the page edge. Breaking mid-cluster is not
   * typographically correct, but a visible wrap beats text disappearing into
   * the margin.
   */
  private hardSplit(doc: PDFKit.PDFDocument, atom: Atom, maxWidth: number): Atom[] {
    doc.font(this.fontFor(atom.isOfficial, atom.bold));
    const pieces: Atom[] = [];
    let current = '';

    for (const character of [...atom.text]) {
      const candidate = current + character;
      if (current !== '' && doc.widthOfString(candidate) > maxWidth) {
        pieces.push({ ...atom, text: current, width: doc.widthOfString(current) });
        current = character;
      } else {
        current = candidate;
      }
    }

    if (current !== '') {
      pieces.push({ ...atom, text: current, width: doc.widthOfString(current) });
    }
    return pieces;
  }

  /**
   * Draws a justified paragraph whose spans may differ in weight.
   *
   * Written here rather than handed to PDFKit's own `text()` because PDFKit
   * wraps and aligns each `continued` call independently: a paragraph with bold
   * values inside it comes apart at every weight change, and the two faces sit
   * at different heights because their ascents differ. Laying out atoms and
   * drawing each line on one shared alphabetic baseline is what keeps a
   * mixed-weight, mixed-script line looking like a single line of type.
   */
  protected paragraph(
    doc: PDFKit.PDFDocument,
    spans: Span[],
    options: {
      indent?: number;
      justify?: boolean;
      leading?: number;
      align?: 'left' | 'center';
    } = {},
  ): void {
    const left = doc.page.margins.left;
    const width = this.contentWidth(doc);
    const align = options.align ?? 'left';
    // A centred paragraph takes neither the first-line indent nor justification:
    // both exist to shape a flush-left block, and either one applied to centred
    // text pulls it off the page's centre line.
    const indent = options.indent ?? (align === 'center' ? 0 : 28);
    const justify = options.justify ?? align === 'left';
    // The font's own line height is the minimum that avoids collisions, which is
    // tighter than an official letter is set. The school's form leaves visible
    // air between lines, and the extra also gives the office room to write over
    // a dotted field by hand.
    const lineHeight = this.lineHeight(doc) * (options.leading ?? 1.34);

    const atoms = this.toAtoms(doc, spans);
    if (atoms.length === 0) return;

    // Greedy line breaking over chunks — runs of atoms glued together, which
    // move to the next line as one. `available` shrinks by the indent on the
    // first line only, which is how the paragraphs on the school's own form are
    // set.
    const lines: Atom[][] = [];
    let current: Atom[] = [];
    let used = 0;
    let available = width - indent;

    const flush = (): void => {
      // Trailing spaces would be stretched by justification into a visible gap
      // at the right edge.
      while (current.length > 0 && current[current.length - 1].isSpace) current.pop();
      lines.push(current);
      current = [];
      used = 0;
      available = width;
    };

    const place = (piece: Atom): void => {
      // A space that lands at the end of a full line is dropped, not wrapped.
      if (used + piece.width > available && current.length > 0) {
        flush();
        if (piece.isSpace) return;
      }
      if (piece.isSpace && current.length === 0) return;
      current.push(piece);
      used += piece.width;
    };

    for (const chunk of this.chunks(atoms)) {
      const chunkWidth = chunk.reduce((total, atom) => total + atom.width, 0);
      if (chunkWidth <= available) {
        // Fits on a fresh line at least: take it whole or move it down whole.
        if (used + chunkWidth > available && current.length > 0) flush();
        chunk.forEach(place);
        continue;
      }
      // Wider than any line: the glue has to give, and a single over-long atom
      // is cut where the measure runs out.
      for (const atom of chunk) {
        const pieces =
          atom.width > available && !atom.isSpace ? this.hardSplit(doc, atom, available) : [atom];
        pieces.forEach(place);
      }
    }
    if (current.length > 0) flush();

    // `y` is tracked here rather than read back from `doc.y`: every `doc.text`
    // call advances the cursor by the line height of *its own* font, so a line
    // that ends in Helvetica and one that ends in Lao would leave the cursor at
    // different heights and the paragraph's leading would visibly drift.
    let y = doc.y;

    lines.forEach((line, index) => {
      const isFirst = index === 0;
      const isLast = index === lines.length - 1;
      const firstIndent = isFirst ? indent : 0;
      const lineWidth = width - firstIndent;
      let lineX = left + firstIndent;

      if (align === 'center') {
        // Centred on the measure, so the line sits on the page's centre line
        // whatever mix of faces and weights it happens to be set in.
        const textWidth = line.reduce((total, atom) => total + atom.width, 0);
        lineX = left + Math.max(0, (width - textWidth) / 2);
      }

      this.drawAtoms(doc, line, {
        x: lineX,
        y,
        width: lineWidth,
        // The last line of a paragraph is never stretched; doing so is what
        // produces the rivers of white space that mark a bad justification.
        justify: justify && !isLast,
        lineHeight,
      });
      y += lineHeight;
    });

    doc.y = y;
    doc.x = left;
  }

  /** Groups atoms into the runs a line break may not fall inside. */
  private chunks(atoms: Atom[]): Atom[][] {
    const chunks: Atom[][] = [];
    for (const atom of atoms) {
      const last = chunks[chunks.length - 1];
      if (last && atom.glueBefore) last.push(atom);
      else chunks.push([atom]);
    }
    return chunks;
  }

  private drawAtoms(
    doc: PDFKit.PDFDocument,
    line: Atom[],
    options: { x: number; y: number; width: number; justify: boolean; lineHeight: number },
  ): void {
    if (line.length === 0) return;

    const textWidth = line.reduce((total, atom) => total + atom.width, 0);
    const spaceAtoms = line.filter((atom) => atom.isSpace);
    const slack = options.width - textWidth;
    // Only stretch when there is somewhere to put the slack and the amount is
    // small enough not to look deliberate. Lao writes whole phrases without a
    // space, so a line can hold three spaces and a lot of slack; stretching
    // those to fill the measure opens rivers a reader sees before the words.
    // Past the cap the line is left ragged instead.
    const naturalSpace = spaceAtoms[0]?.width ?? 0;
    const wanted =
      options.justify && spaceAtoms.length > 0 && slack > 0 ? slack / spaceAtoms.length : 0;
    const extraPerSpace = wanted <= naturalSpace * MAX_SPACE_STRETCH ? wanted : 0;

    const baselineY = options.y + options.lineHeight * 0.72;
    let cursorX = options.x;

    for (const atom of line) {
      doc.font(this.fontFor(atom.isOfficial, atom.bold));
      doc.text(atom.text, cursorX, baselineY, { lineBreak: false, baseline: 'alphabetic' });
      cursorX += atom.width + (atom.isSpace ? extraPerSpace : 0);
    }
  }

  /** One line of mixed-script text at an explicit position. Returns its bottom. */
  protected line(
    doc: PDFKit.PDFDocument,
    text: string,
    options: {
      x?: number;
      y?: number;
      width?: number;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
    } = {},
  ): number {
    const x = options.x ?? doc.page.margins.left;
    const y = options.y ?? doc.y;
    const width = options.width ?? this.contentWidth(doc);
    const atoms = this.toAtoms(doc, [{ text, bold: options.bold }]);
    const lineHeight = this.lineHeight(doc);

    if (atoms.length === 0) return y;

    const totalWidth = atoms.reduce((total, atom) => total + atom.width, 0);
    let startX = x;
    if (options.align === 'center') startX = x + Math.max(0, (width - totalWidth) / 2);
    else if (options.align === 'right') startX = x + Math.max(0, width - totalWidth);

    this.drawAtoms(doc, atoms, {
      x: startX,
      y,
      width: totalWidth,
      justify: false,
      lineHeight,
    });

    const bottom = y + lineHeight;
    doc.y = bottom;
    doc.x = doc.page.margins.left;
    return bottom;
  }

  /** The width of a run of mixed-script text at the current size. */
  protected widthOf(doc: PDFKit.PDFDocument, spans: Span[]): number {
    return this.toAtoms(doc, spans).reduce((total, atom) => total + atom.width, 0);
  }
}
