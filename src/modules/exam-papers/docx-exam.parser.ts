import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { ExamOptionLabelStyle } from 'src/common/constants/enums';
import { hasMath, normaliseMathDelimiters, splitMath, stripTexComments } from './math/latex-text';
import { isValidTex } from './math/mathjax';
import { ommlToLatex } from './math/omml-to-latex';
import { isDrawable } from './print/image-check';
import { convertMetafiles, MetafileInput } from './print/metafile-converter';

/**
 * Reads a teacher's Word file into questions.
 *
 * There is no schema for an exam paper in Word — every teacher lays theirs out
 * a little differently — so this is a reader of *conventions*, and the review
 * page exists for everything the conventions miss. The conventions it knows:
 *
 *   - a question starts a paragraph with its number: `1.` `12)` `ຂໍ້ 3.` — or
 *     is an item of a decimal auto-numbered list;
 *   - an option starts with its letter, `A.` … `F.` or `ກ.` … `ສ.`, at the start
 *     of a paragraph or after whitespace, so two options on one line separated
 *     by a tab are two options — or is an item of a lettered list;
 *   - the letters come in order, and a letter out of order is text, not a
 *     marker (so `ສ.ປ.ປ ລາວ` in a stem is not option six);
 *   - the right answer is the one option set apart from its siblings — bold
 *     first, then underlined, highlighted, or coloured;
 *   - a paragraph that is neither, between questions, is a part heading
 *     (`ພາກ II`), and the questions under it stay under it when shuffled;
 *   - a picture in its own paragraph belongs to the stem if no option has
 *     been seen yet, and to the last option otherwise;
 *   - a formula is LaTeX between `$…$`: a Word equation is turned into one,
 *     and a MathType equation the teacher converted to TeX in Word (MathType
 *     → Convert Equations → TeX) already is one, once its comment lines go.
 *
 * Images are returned as bytes; the caller decides where they live.
 */

export type ExamParseWarningCode =
  /** No option was marked as the answer, or more than one was. */
  | 'noAnswer'
  /** Fewer than two options were found. */
  | 'fewOptions'
  /** A letter appeared out of sequence and was read as text. */
  | 'optionSequence'
  /** A picture the printer cannot draw — EMF, WMF, GIF, or a damaged file. */
  | 'unsupportedImage'
  /** The file held no questions at all. */
  | 'noQuestions'
  /** A formula between `$…$` that MathJax could not read; `detail` is the TeX. */
  | 'mathInvalid';

export interface ExamParseWarning {
  code: ExamParseWarningCode;
  /** The question's ordinal in the file, when the warning is about one. */
  question: number | null;
  detail?: string;
}

export interface ParsedImage {
  id: string;
  buffer: Buffer;
  mimeType: string;
  widthPt: number;
  heightPt: number;
  /**
   * How far the picture's bottom edge sits below the text baseline, in
   * points: Word's `w:position` on the run. MathType lowers each equation so
   * its own baseline meets the line's; a plain picture sits on the line.
   */
  descentPt: number;
}

export interface ParsedOption {
  text: string;
  imageIds: string[];
}

export interface ParsedQuestion {
  section: string | null;
  text: string;
  imageIds: string[];
  options: ParsedOption[];
  correctIndex: number | null;
  lockOptions: boolean;
}

export interface ParsedExam {
  preamble: string;
  questions: ParsedQuestion[];
  optionLabelStyle: ExamOptionLabelStyle;
  warnings: ExamParseWarning[];
  images: ParsedImage[];
}

// ── Conventions ─────────────────────────────────────────────────────────────

const LATIN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LAO_LETTERS = ['ກ', 'ຂ', 'ຄ', 'ງ', 'ຈ', 'ສ'];

/** `1.` `12)` `ຂໍ້ 3.` `ຂໍ້ທີ 3:` at the head of a paragraph. */
const QUESTION_START = /^\s*(?:ຂໍ້\s*(?:ທີ\s*)?)?(\d{1,3})\s*[.)]\s*/u;

/**
 * A letter followed by `.` or `)`, at the head of the paragraph or after
 * whitespace, or after a picture. Which letters are *accepted* is decided by
 * the sequence check, not here.
 */
const OPTION_MARKER = /(?<=^|[\s￼])([A-Fa-fກຂຄງຈສ])\s*[.)]\s*/gu;

/**
 * Wording that refers to the other options by letter, which is wrong the
 * moment the letters move: ຖືກທຸກຂໍ້, ບໍ່ມີຂໍ້ໃດຖືກ, ທັງ A ແລະ B, all of the above.
 */
const REFERS_TO_SIBLINGS =
  /ທຸກຂໍ້|ບໍ່ມີຂໍ້ໃດ|ຖືກທັງ|ທັງ\s*[A-Fa-fກຂຄງຈສ]\b|ຂໍ້\s*[A-Fa-fກຂຄງຈສ]\b|all of the above|none of the above|\bboth\s+[a-f]\b|\b[a-f]\s+(?:and|&)\s+[a-f]\b/iu;

/** Formats the printer can draw — pdfkit takes PNG and JPEG, nothing else. */
const PRINTABLE_IMAGES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * How much of Word's box a drawn metafile is printed at when only its ink
 * could be drawn, not its canvas — the ink of an equation is a little smaller
 * than the box Word gives it.
 */
const METAFILE_INK_SCALE = 0.85;

/** English Metric Units per point — Word's unit for picture extents. */
const EMU_PER_PT = 12700;

/** Where a picture sits in the flattened paragraph text. */
const IMAGE_PLACEHOLDER = '￼';

/**
 * How a picture is written into the text it belongs to: `⟦1⟧` is the first
 * picture of that stem or option, `⟦2⟧` the second. A MathType equation is a
 * picture in the middle of a sentence — "ໃຫ້ກຸ່ມ ⟦1⟧ ແລະ ⟦2⟧" — and moving
 * it to the end would leave the sentence unreadable. The printer draws the
 * picture where the token stands.
 */
export const IMAGE_TOKEN = /⟦(\d+)⟧/g;
export const imageToken = (index: number) => `⟦${index + 1}⟧`;

/** Renumbers the tokens of `text` so they follow `offset` earlier pictures. */
export function shiftImageTokens(text: string, offset: number): string {
  return text.replace(IMAGE_TOKEN, (_, n: string) => imageToken(Number(n) - 1 + offset));
}

// ── Paragraph model ─────────────────────────────────────────────────────────

type Emphasis = 'bold' | 'underline' | 'highlight' | 'color';
const EMPHASES: Emphasis[] = ['bold', 'underline', 'highlight', 'color'];

/** One character of a paragraph with the emphasis its run carried. */
interface Char {
  ch: string;
  emphasis: Set<Emphasis>;
  /** Set when `ch` is the image placeholder. */
  imageId?: string;
}

type Numbering = 'decimal' | 'letter' | null;

interface Paragraph {
  chars: Char[];
  numbering: Numbering;
}

/** A slice of a paragraph: its text, its pictures, and how emphasised it was. */
interface Piece {
  text: string;
  imageIds: string[];
  /** Fraction of non-space characters carrying each emphasis. */
  emphasis: Record<Emphasis, number>;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function parseExamDocx(file: Buffer): Promise<ParsedExam> {
  const zip = await JSZip.loadAsync(file);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new DocxNotAWordFileError();

  const relationships = parseRelationships(
    await zip.file('word/_rels/document.xml.rels')?.async('string'),
  );
  const numbering = parseNumbering(await zip.file('word/numbering.xml')?.async('string'));

  const images = new ImageStore(zip, relationships);
  const document = new DOMParser().parseFromString(documentXml, 'text/xml');
  const body = firstChild(document.documentElement, 'w:body');
  if (!body) throw new DocxNotAWordFileError();

  const paragraphs: Paragraph[] = [];
  collectParagraphs(body, paragraphs, images, numbering);

  const reader = new ExamReader(images);
  for (const paragraph of withoutTexComments(paragraphs)) reader.feed(paragraph);
  const parsed = reader.finish();

  return { ...parsed, images: await images.loadPrintable(parsed.warnings) };
}

export class DocxNotAWordFileError extends Error {
  constructor() {
    super('The file is not a Word document (no word/document.xml inside)');
    this.name = 'DocxNotAWordFileError';
  }
}

// ── The reader ──────────────────────────────────────────────────────────────

interface OpenQuestion extends ParsedQuestion {
  /** Emphasis per option, kept until the question closes and is judged. */
  optionEmphasis: Record<Emphasis, number>[];
  /** Emphasis of the option markers themselves — `B.` set bold on its own. */
  markerEmphasis: Record<Emphasis, number>[];
}

/**
 * The state machine. One paragraph at a time; the current question stays
 * open until something that cannot belong to it arrives.
 */
class ExamReader {
  private readonly questions: ParsedQuestion[] = [];
  private readonly warnings: ExamParseWarning[] = [];
  private readonly preambleLines: string[] = [];
  private pendingSection: string[] = [];
  private section: string | null = null;
  private current: OpenQuestion | null = null;
  private style: ExamOptionLabelStyle | null = null;

  constructor(private readonly images: ImageStore) {}

  feed(paragraph: Paragraph): void {
    const plain = paragraph.chars.map((c) => c.ch).join('');
    if (!plain.trim()) return;

    const questionStart = paragraph.numbering === 'decimal' ? null : QUESTION_START.exec(plain);
    if (questionStart || paragraph.numbering === 'decimal') {
      this.close();
      this.openQuestion(paragraph, questionStart ? questionStart[0].length : 0);
      return;
    }

    if (this.current) {
      const options = this.readOptions(paragraph, 0, paragraph.numbering === 'letter');
      if (options.length > 0) {
        this.appendOptions(options);
        return;
      }
      const piece = slice(paragraph.chars, 0, paragraph.chars.length);
      if (this.current.options.length === 0) {
        // Still the stem: a second line of it, or its picture.
        this.current.text = joinLines(
          this.current.text,
          shiftImageTokens(piece.text, this.current.imageIds.length),
        );
        this.current.imageIds.push(...piece.imageIds);
        return;
      }
      const last = this.current.options[this.current.options.length - 1];
      if (!piece.text.replace(IMAGE_TOKEN, '').trim() && piece.imageIds.length > 0) {
        // A picture on its own line under the options belongs to the last one.
        last.text = joinLines(last.text, shiftImageTokens(piece.text, last.imageIds.length));
        last.imageIds.push(...piece.imageIds);
        return;
      }
      if (!last.text.trim() && last.imageIds.length === 0) {
        // The letter in one table cell and the words in the next: the words
        // are the option's.
        last.text = piece.text.trim();
        last.imageIds.push(...piece.imageIds);
        // The words carry the emphasis that says whether this is the answer.
        this.current.optionEmphasis[this.current.options.length - 1] = piece.emphasis;
        return;
      }
      this.close();
    }

    // Between questions, or before the first: a heading, or the header.
    const piece = slice(paragraph.chars, 0, paragraph.chars.length);
    if (this.questions.length === 0) this.preambleLines.push(piece.text.trim());
    else this.pendingSection.push(piece.text.trim());
  }

  finish(): Omit<ParsedExam, 'images'> {
    this.close();
    if (this.questions.length === 0) {
      this.warnings.push({ code: 'noQuestions', question: null });
    }
    return {
      preamble: this.preambleLines.join('\n').trim(),
      questions: this.questions,
      optionLabelStyle: this.style ?? 'latin',
      warnings: this.warnings,
    };
  }

  private openQuestion(paragraph: Paragraph, stemStart: number): void {
    if (this.pendingSection.length > 0) {
      this.section = this.pendingSection.join('\n');
      this.pendingSection = [];
    }
    const options = this.readOptions(paragraph, stemStart, false);
    const stemEnd = options.length > 0 ? options[0].markerStart : paragraph.chars.length;
    const stem = slice(paragraph.chars, stemStart, stemEnd);

    this.current = {
      section: this.section,
      text: stem.text.trim(),
      imageIds: stem.imageIds,
      options: [],
      correctIndex: null,
      lockOptions: false,
      optionEmphasis: [],
      markerEmphasis: [],
    };
    this.appendOptions(options);
  }

  private appendOptions(options: FoundOption[]): void {
    if (!this.current) return;
    for (const option of options) {
      this.current.options.push({
        text: option.piece.text.trim(),
        imageIds: option.piece.imageIds,
      });
      this.current.optionEmphasis.push(option.piece.emphasis);
      this.current.markerEmphasis.push(option.markerEmphasis);
    }
  }

  /**
   * Finds the option markers in a paragraph from `from`, accepting only the
   * letter that comes next. `numbered` says the paragraph is an item of a
   * lettered list, so it *is* the next option even without a written letter.
   */
  private readOptions(paragraph: Paragraph, from: number, numbered: boolean): FoundOption[] {
    if (!this.current) return [];
    const plain = paragraph.chars.map((c) => c.ch).join('');
    const found: OptionMarker[] = [];
    let expected = this.current.options.length;

    if (numbered) {
      found.push({ markerStart: from, contentStart: from, markerEmphasis: emptyEmphasis() });
      expected += 1;
    }

    OPTION_MARKER.lastIndex = from;
    let match: RegExpExecArray | null;
    while ((match = OPTION_MARKER.exec(plain)) !== null) {
      const letter = match[1];
      const markerStart = match.index;
      const style = styleOf(letter);
      if (this.style && style !== this.style) continue;
      const letters = style === 'lao' ? LAO_LETTERS : LATIN_LETTERS;
      if (letters[expected] !== letter.toUpperCase()) {
        // A letter that is not the next one is text (`ສ.ປ.ປ ລາວ` mid-stem) —
        // unless it heads the paragraph, where it was almost certainly meant
        // as a marker: keep the option, since losing it would lose the
        // teacher's work, and say that the lettering broke so they check it.
        if (markerStart !== from) continue;
        this.warnings.push({
          code: 'optionSequence',
          question: this.questions.length + 1,
          detail: letter,
        });
      }
      if (!this.style) this.style = style;
      found.push({
        markerStart,
        contentStart: match.index + match[0].length,
        markerEmphasis: emphasisOf(paragraph.chars.slice(markerStart, markerStart + letter.length)),
      });
      expected += 1;
    }

    return found.map((option, index) => {
      const end = index + 1 < found.length ? found[index + 1].markerStart : paragraph.chars.length;
      return { ...option, piece: slice(paragraph.chars, option.contentStart, end) };
    });
  }

  /** Judges the open question — the answer, the lock — and files it. */
  private close(): void {
    const question = this.current;
    if (!question) return;
    this.current = null;
    const ordinal = this.questions.length + 1;

    if (question.options.length < 2) {
      this.warnings.push({ code: 'fewOptions', question: ordinal });
    }

    question.correctIndex = judgeAnswer(question.optionEmphasis, question.markerEmphasis);
    if (question.correctIndex === null && question.options.length >= 2) {
      this.warnings.push({ code: 'noAnswer', question: ordinal });
    }

    question.lockOptions = question.options.some((option) => REFERS_TO_SIBLINGS.test(option.text));
    for (const text of [question.text, ...question.options.map((option) => option.text)]) {
      if (!hasMath(text)) continue;
      for (const piece of splitMath(text)) {
        if (piece.kind === 'math' && !isValidTex(piece.tex)) {
          this.warnings.push({ code: 'mathInvalid', question: ordinal, detail: piece.tex });
        }
      }
    }

    this.questions.push({
      section: question.section,
      text: question.text,
      imageIds: question.imageIds,
      options: question.options,
      correctIndex: question.correctIndex,
      lockOptions: question.lockOptions,
    });
  }
}

interface OptionMarker {
  markerStart: number;
  contentStart: number;
  markerEmphasis: Record<Emphasis, number>;
}

interface FoundOption extends OptionMarker {
  piece: Piece;
}

/**
 * The option set apart from its siblings.
 *
 * Each kind of emphasis is judged on its own, strongest convention first: a
 * paper whose stems are all blue and whose answers are bold must not lose the
 * bold answer because "colour" found four coloured options. An option carries
 * an emphasis when most of its text does, or when its marker alone does —
 * `**B.** ທິດເໜືອ` is a marked answer too.
 */
function judgeAnswer(
  options: Record<Emphasis, number>[],
  markers: Record<Emphasis, number>[],
): number | null {
  for (const kind of EMPHASES) {
    const carrying = options
      .map((option, index) => (option[kind] >= 0.5 || markers[index][kind] >= 1 ? index : -1))
      .filter((index) => index >= 0);
    if (carrying.length === 1) return carrying[0];
  }
  return null;
}

function styleOf(letter: string): ExamOptionLabelStyle {
  return LAO_LETTERS.includes(letter) ? 'lao' : 'latin';
}

function emptyEmphasis(): Record<Emphasis, number> {
  return { bold: 0, underline: 0, highlight: 0, color: 0 };
}

function emphasisOf(chars: Char[]): Record<Emphasis, number> {
  const counted = chars.filter((c) => !/\s/.test(c.ch) && !c.imageId);
  const result = emptyEmphasis();
  if (counted.length === 0) return result;
  for (const kind of EMPHASES) {
    result[kind] = counted.filter((c) => c.emphasis.has(kind)).length / counted.length;
  }
  return result;
}

/** Text and pictures of `chars[from, to)`, tabs collapsed to spaces. */
function slice(chars: Char[], from: number, to: number): Piece {
  const part = chars.slice(from, to);
  // Each picture stays in the text as its token, so an equation in the
  // middle of a sentence is printed in the middle of the sentence.
  const imageIds: string[] = [];
  const text = part
    .map((c) => {
      if (!c.imageId) return c.ch;
      imageIds.push(c.imageId);
      return imageToken(imageIds.length - 1);
    })
    .join('')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/ {2,}/g, ' ');
  return { text: normaliseMathDelimiters(text), imageIds, emphasis: emphasisOf(part) };
}

function joinLines(a: string, b: string): string {
  const next = b.trim();
  if (!next) return a;
  return a ? `${a}\n${next}` : next;
}

/**
 * MathType's TeX conversion leaves each equation's record as comment lines
 * in the text (see `stripTexComments`), and Word breaks the sentence into
 * paragraphs around them. The comments go, and the paragraph after a
 * comment is glued back onto the one before it — so "1. ໃຫ້" and "$x=…$
 * ແລ້ວ…" are one question again.
 */
function withoutTexComments(paragraphs: Paragraph[]): Paragraph[] {
  const out: Paragraph[] = [];
  let glue = false;
  for (const paragraph of paragraphs) {
    const plain = paragraph.chars.map((c) => c.ch).join('');
    if (!/%/.test(plain) && !glue) {
      out.push(paragraph);
      continue;
    }
    const { text, endedInComment } = stripTexComments(plain);
    const chars = keepChars(paragraph.chars, text);
    const previous = out[out.length - 1];
    if (glue && previous && chars.length > 0) {
      previous.chars.push({ ch: ' ', emphasis: new Set() }, ...chars);
    } else if (chars.length > 0) {
      out.push({ chars, numbering: paragraph.numbering });
    }
    glue = endedInComment || (glue && chars.length === 0);
  }
  return out;
}

/** The characters of `chars` that survived into `text`, in order, emphasis and pictures kept. */
function keepChars(chars: Char[], text: string): Char[] {
  const kept: Char[] = [];
  let at = 0;
  for (const ch of text) {
    while (at < chars.length && chars[at].ch !== ch) at += 1;
    if (at >= chars.length) break;
    kept.push(chars[at]);
    at += 1;
  }
  return kept;
}

// ── Word XML ────────────────────────────────────────────────────────────────

type Relationships = Map<string, string>;

/** `rId7 → media/image3.png` — the map from a picture's reference to its file. */
function parseRelationships(xml: string | undefined): Relationships {
  const map: Relationships = new Map();
  if (!xml) return map;
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  for (const rel of Array.from(document.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target.replace(/^\/?word\//, ''));
  }
  return map;
}

/**
 * `numId → ilvl → 'decimal' | 'letter' | null` — what Word's auto-numbering
 * would print in front of a list paragraph, since the text itself has no
 * number in it.
 */
function parseNumbering(xml: string | undefined): Map<string, Map<string, Numbering>> {
  const byNum = new Map<string, Map<string, Numbering>>();
  if (!xml) return byNum;
  const document = new DOMParser().parseFromString(xml, 'text/xml');

  const byAbstract = new Map<string, Map<string, Numbering>>();
  for (const abstract of Array.from(document.getElementsByTagName('w:abstractNum'))) {
    const id = abstract.getAttribute('w:abstractNumId');
    if (!id) continue;
    const levels = new Map<string, Numbering>();
    for (const level of Array.from(abstract.getElementsByTagName('w:lvl'))) {
      const ilvl = level.getAttribute('w:ilvl') ?? '0';
      const format = firstChild(level, 'w:numFmt')?.getAttribute('w:val') ?? '';
      levels.set(
        ilvl,
        format === 'decimal'
          ? 'decimal'
          : format === 'upperLetter' || format === 'lowerLetter'
            ? 'letter'
            : null,
      );
    }
    byAbstract.set(id, levels);
  }

  for (const num of Array.from(document.getElementsByTagName('w:num'))) {
    const id = num.getAttribute('w:numId');
    const abstractId = firstChild(num, 'w:abstractNumId')?.getAttribute('w:val');
    if (id && abstractId && byAbstract.has(abstractId)) {
      byNum.set(id, byAbstract.get(abstractId)!);
    }
  }
  return byNum;
}

function firstChild(node: Node | null | undefined, tag: string): Element | null {
  if (!node) return null;
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 1 && child.nodeName === tag) return child as Element;
  }
  return null;
}

/**
 * Every paragraph of the body in reading order — including those inside table
 * cells (a common way of laying out four options in a grid) and text boxes.
 * `mc:Fallback` is skipped because it repeats what `mc:Choice` already said.
 */
function collectParagraphs(
  node: Node,
  out: Paragraph[],
  images: ImageStore,
  numbering: Map<string, Map<string, Numbering>>,
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (element.nodeName === 'mc:Fallback' || element.nodeName === 'w:sectPr') continue;
    if (element.nodeName === 'w:p') {
      out.push({
        chars: readParagraph(element, images),
        numbering: numberingOf(element, numbering),
      });
    }
    // Recurse into everything — a text box's paragraphs live inside a run of
    // the paragraph that anchors it, and come out after it, which is where
    // they read.
    collectParagraphs(element, out, images, numbering);
  }
}

function numberingOf(
  paragraph: Element,
  numbering: Map<string, Map<string, Numbering>>,
): Numbering {
  const numPr = firstChild(firstChild(paragraph, 'w:pPr'), 'w:numPr');
  if (!numPr) return null;
  const numId = firstChild(numPr, 'w:numId')?.getAttribute('w:val');
  const ilvl = firstChild(numPr, 'w:ilvl')?.getAttribute('w:val') ?? '0';
  if (!numId) return null;
  return numbering.get(numId)?.get(ilvl) ?? null;
}

/** The paragraph's own runs, flattened to characters. */
function readParagraph(paragraph: Element, images: ImageStore): Char[] {
  const chars: Char[] = [];
  walkRuns(paragraph, chars, images);
  return chars;
}

const SKIPPED_IN_RUNS = new Set(['w:pPr', 'w:rPr', 'w:del', 'w:txbxContent', 'mc:Fallback']);

function walkRuns(node: Node, out: Char[], images: ImageStore): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (SKIPPED_IN_RUNS.has(element.nodeName)) continue;
    if (element.nodeName === 'w:r') {
      readRun(element, out, images);
      continue;
    }
    if (element.nodeName === 'm:oMath') {
      // A Word equation, as the TeX between dollars it is kept as.
      for (const ch of `$${ommlToLatex(element)}$`) out.push({ ch, emphasis: new Set() });
      continue;
    }
    if (element.nodeName === 'm:oMathPara') {
      // A paragraph of equations, each on display.
      for (const math of Array.from(element.childNodes)) {
        if (math.nodeType !== 1 || math.nodeName !== 'm:oMath') continue;
        for (const ch of `$$${ommlToLatex(math as Element)}$$`) {
          out.push({ ch, emphasis: new Set() });
        }
      }
      continue;
    }
    // w:hyperlink, w:ins, w:smartTag, w:sdt/w:sdtContent, w:fldSimple …
    walkRuns(element, out, images);
  }
}

function readRun(run: Element, out: Char[], images: ImageStore): void {
  const emphasis = runEmphasis(firstChild(run, 'w:rPr'));
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    switch (element.nodeName) {
      case 'w:t':
        for (const ch of element.textContent ?? '') out.push({ ch, emphasis });
        break;
      case 'w:tab':
        out.push({ ch: '\t', emphasis });
        break;
      case 'w:br':
      case 'w:cr':
        if (element.getAttribute('w:type') !== 'page') out.push({ ch: '\n', emphasis });
        break;
      case 'w:noBreakHyphen':
        out.push({ ch: '-', emphasis });
        break;
      case 'w:drawing':
      case 'w:pict':
      case 'w:object': {
        const imageId = images.register(element);
        if (imageId) out.push({ ch: IMAGE_PLACEHOLDER, emphasis, imageId });
        break;
      }
      case 'mc:AlternateContent': {
        // A picture wrapped for older Word: read the modern half only.
        const choice = firstChild(element, 'mc:Choice');
        if (choice) readRun(choice, out, images);
        break;
      }
      default:
        break;
    }
  }
}

/** `<w:b/>` is on; `<w:b w:val="0"/>` and `<w:b w:val="false"/>` are off. */
function isOn(element: Element | null): boolean {
  if (!element) return false;
  const value = element.getAttribute('w:val');
  return value === null || !(value === '0' || value === 'false' || value === 'off');
}

function runEmphasis(rPr: Element | null): Set<Emphasis> {
  const emphasis = new Set<Emphasis>();
  if (!rPr) return emphasis;
  if (isOn(firstChild(rPr, 'w:b'))) emphasis.add('bold');
  const underline = firstChild(rPr, 'w:u');
  if (underline && underline.getAttribute('w:val') !== 'none') emphasis.add('underline');
  const highlight = firstChild(rPr, 'w:highlight');
  if (highlight && highlight.getAttribute('w:val') !== 'none') emphasis.add('highlight');
  const shading = firstChild(rPr, 'w:shd');
  if (shading && (shading.getAttribute('w:fill') ?? 'auto') !== 'auto') emphasis.add('highlight');
  const color = firstChild(rPr, 'w:color')?.getAttribute('w:val')?.toUpperCase() ?? 'AUTO';
  if (color !== 'AUTO' && color !== '000000') emphasis.add('color');
  return emphasis;
}

/**
 * The pictures a document refers to, loaded once each even when the same
 * picture is placed twice, and read from the zip only at the end.
 */
class ImageStore {
  private readonly pending = new Map<
    string,
    { target: string; widthPt: number; heightPt: number; descentPt: number }
  >();
  private counter = 0;

  constructor(
    private readonly zip: JSZip,
    private readonly relationships: Relationships,
  ) {}

  /** Notes a `w:drawing` / `w:pict`, and returns its id — or null if it holds no picture. */
  register(element: Element): string | null {
    const blip = element.getElementsByTagName('a:blip')[0];
    const imagedata = element.getElementsByTagName('v:imagedata')[0];
    const relId =
      blip?.getAttribute('r:embed') ??
      blip?.getAttribute('r:link') ??
      imagedata?.getAttribute('r:id');
    if (!relId) return null;
    const target = this.relationships.get(relId);
    if (!target) return null;

    const size = blip ? extentOf(element) : shapeSizeOf(element);
    const id = `img${++this.counter}`;
    this.pending.set(id, { target, ...size, descentPt: descentOf(element) });
    return id;
  }

  /**
   * Reads the printable ones, has the metafiles drawn, and warns about the
   * rest one by one.
   */
  async loadPrintable(warnings: ExamParseWarning[]): Promise<ParsedImage[]> {
    const images: ParsedImage[] = [];
    const metafiles: MetafileInput[] = [];
    const sizes = new Map<string, { widthPt: number; heightPt: number; descentPt: number }>();

    for (const [id, { target, widthPt, heightPt, descentPt }] of this.pending) {
      const extension = target.split('.').pop()?.toLowerCase() ?? '';
      const file = this.zip.file(`word/${target}`);
      const buffer = file ? await file.async('nodebuffer') : null;
      if (buffer && (extension === 'wmf' || extension === 'emf')) {
        metafiles.push({ id, buffer, extension });
        sizes.set(id, { widthPt, heightPt, descentPt });
        continue;
      }
      const mimeType = PRINTABLE_IMAGES[extension];
      if (!mimeType || !buffer || !isDrawable(buffer, mimeType)) {
        warnings.push({ code: 'unsupportedImage', question: null, detail: extension || target });
        continue;
      }
      images.push({
        id,
        buffer,
        mimeType,
        widthPt: Math.max(1, Math.round(widthPt)),
        heightPt: Math.max(1, Math.round(heightPt)),
        descentPt,
      });
    }

    if (metafiles.length > 0) {
      const converted = await convertMetafiles(metafiles);
      for (const input of metafiles) {
        const png = converted.get(input.id);
        const size = sizes.get(input.id)!;
        if (!png) {
          warnings.push({ code: 'unsupportedImage', question: null, detail: input.extension });
          continue;
        }
        // The whole canvas prints at Word's size for the object, which is
        // the size the teacher saw it at. Ink alone — the canvas could not
        // be found — takes a little under Word's height and the width its
        // own proportions give.
        const heightPt = png.canvas
          ? Math.max(1, Math.round(size.heightPt))
          : Math.max(1, Math.round(size.heightPt * METAFILE_INK_SCALE));
        const widthPt = png.canvas
          ? Math.max(1, Math.round(size.widthPt))
          : Math.max(1, Math.round((heightPt * png.widthPx) / png.heightPx));
        images.push({
          id: input.id,
          buffer: png.png,
          mimeType: 'image/png',
          widthPt,
          heightPt,
          descentPt: size.descentPt,
        });
      }
    }
    return images;
  }
}

/**
 * `<w:position w:val>` on the run the picture is in — half-points, negative
 * when lowered — as points below the baseline, 0 when the run says nothing.
 */
function descentOf(element: Element): number {
  let node: Node | null = element;
  while (node && node.nodeName !== 'w:r') node = node.parentNode;
  if (!node) return 0;
  const position = firstChild(firstChild(node as Element, 'w:rPr'), 'w:position');
  const value = Number(position?.getAttribute('w:val') ?? 0);
  return Number.isFinite(value) && value !== 0 ? -value / 2 : 0;
}

/** `<wp:extent cx cy>` in EMU, for a modern drawing. */
function extentOf(drawing: Element): { widthPt: number; heightPt: number } {
  const extent = drawing.getElementsByTagName('wp:extent')[0];
  const cx = Number(extent?.getAttribute('cx') ?? 0);
  const cy = Number(extent?.getAttribute('cy') ?? 0);
  if (cx > 0 && cy > 0) return { widthPt: cx / EMU_PER_PT, heightPt: cy / EMU_PER_PT };
  return { widthPt: 200, heightPt: 150 };
}

/** `style="width:123.4pt;height:56pt"` on a legacy `v:shape`. */
function shapeSizeOf(pict: Element): { widthPt: number; heightPt: number } {
  const shape = pict.getElementsByTagName('v:shape')[0];
  const style = shape?.getAttribute('style') ?? '';
  const width = /width:\s*([\d.]+)pt/.exec(style);
  const height = /height:\s*([\d.]+)pt/.exec(style);
  if (width && height) return { widthPt: Number(width[1]), heightPt: Number(height[1]) };
  return { widthPt: 200, heightPt: 150 };
}
