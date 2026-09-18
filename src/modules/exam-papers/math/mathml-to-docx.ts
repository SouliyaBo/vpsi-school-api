import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import {
  Math as DocxMath,
  MathComponent,
  MathCurlyBrackets,
  MathFraction,
  MathFunction,
  MathIntegral,
  MathLimitLower,
  MathRadical,
  MathRoundBrackets,
  MathRun,
  MathSquareBrackets,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
} from 'docx';
import { texToMathML } from './mathjax';

/**
 * A formula as a Word equation — so the teacher who opens the exported
 * Word file finds an equation they can edit, not a picture of one.
 *
 * The TeX goes through MathJax to MathML, and the MathML tree is walked
 * into the `docx` library's equation parts: fractions, roots, scripts,
 * brackets, sums and integrals. What Word's equation model has no part for
 * (a matrix, an accent, a stacked limit) is set as its characters in a row,
 * which still reads and still edits.
 */

/** The formula as a Word equation, or null when the TeX does not parse. */
export function texToDocxMath(tex: string, display = false): DocxMath | null {
  const mathml = texToMathML(tex, display);
  if (!mathml) return null;
  const document = new DOMParser().parseFromString(mathml, 'text/xml');
  const root = document.documentElement;
  if (!root) return null;
  return new DocxMath({ children: children(root) });
}

const INVISIBLE = /[⁡-⁤]/g;

function elements(node: Node): Element[] {
  return Array.from(node.childNodes).filter((c): c is Element => c.nodeType === 1);
}

/**
 * The children in order — except that a sum or integral takes everything
 * after it in the row as its body, which is what the writer meant by
 * `\sum_{i=1}^{n} i^2`. MathML leaves the body as the operator's siblings.
 */
function children(node: Node): MathComponent[] {
  return sequence(elements(node));
}

function sequence(kids: Element[]): MathComponent[] {
  const parts: MathComponent[] = [];
  for (let i = 0; i < kids.length; i += 1) {
    const big = bigOperator(kids[i]);
    if (big) {
      parts.push(big(kids.slice(i + 1).flatMap(convert)));
      break;
    }
    parts.push(...convert(kids[i]));
  }
  return parts;
}

/** A `∑` or `∫`, scripted or bare, as a maker of the part once its body is known. */
function bigOperator(element: Element): ((body: MathComponent[]) => MathComponent) | null {
  const scripted = ['msubsup', 'munderover', 'msup', 'msub', 'munder', 'mover'].includes(
    element.nodeName,
  );
  const kids = elements(element);
  const base = scripted ? kids[0] : element;
  if (!base || base.nodeName !== 'mo') return null;
  const operator = text(base).trim();
  const Part = operator === '∑' ? MathSum : operator === '∫' ? MathIntegral : null;
  if (!Part) return null;
  const lower = ['msubsup', 'munderover', 'msub', 'munder'].includes(element.nodeName)
    ? kids[1]
    : undefined;
  const upper =
    element.nodeName === 'msubsup' || element.nodeName === 'munderover'
      ? kids[2]
      : element.nodeName === 'msup' || element.nodeName === 'mover'
        ? kids[1]
        : undefined;
  return (body) =>
    new Part({
      children: body,
      subScript: lower ? convert(lower) : undefined,
      superScript: upper ? convert(upper) : undefined,
    });
}

function text(node: Node): string {
  return (node.textContent ?? '').replace(INVISIBLE, '');
}

/** One MathML element as equation parts. */
function convert(element: Element): MathComponent[] {
  const kids = elements(element);
  switch (element.nodeName) {
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms': {
      const value = text(element);
      return value ? [new MathRun(value)] : [];
    }
    case 'mspace':
      return [new MathRun(' ')];
    case 'mfrac':
      return kids.length === 2
        ? [new MathFraction({ numerator: convert(kids[0]), denominator: convert(kids[1]) })]
        : children(element);
    case 'msqrt':
      return [new MathRadical({ children: children(element) })];
    case 'mroot':
      return kids.length === 2
        ? [new MathRadical({ children: convert(kids[0]), degree: convert(kids[1]) })]
        : children(element);
    case 'msup':
      return kids.length === 2 ? [script(kids[0], null, kids[1])] : children(element);
    case 'msub':
      return kids.length === 2 ? [script(kids[0], kids[1], null)] : children(element);
    case 'msubsup':
      return kids.length === 3 ? [script(kids[0], kids[1], kids[2])] : children(element);
    case 'munderover':
      return kids.length === 3 ? [script(kids[0], kids[1], kids[2])] : children(element);
    case 'munder':
      return kids.length === 2
        ? [new MathLimitLower({ children: convert(kids[0]), limit: convert(kids[1]) })]
        : children(element);
    case 'mover':
      // An accent or a bar: Word has the part, the library does not; the
      // base alone still reads.
      return kids.length === 2 ? convert(kids[0]) : children(element);
    case 'mrow':
      return fenced(kids) ?? children(element);
    case 'mtable':
      return matrix(element);
    case 'mtr':
    case 'mtd':
      return children(element);
    default:
      // mstyle, mpadded, mphantom, semantics, and whatever else: contents.
      return children(element);
  }
}

/** Scripts on anything but a big operator (those are handled in `children`). */
function script(base: Element, sub: Element | null, sup: Element | null): MathComponent {
  const operator = text(base).trim();
  // `\sin^2` — the function name is the base, and Word wants it as a name.
  const parts =
    base.nodeName === 'mi' && operator.length > 1 && /^[a-z]+$/.test(operator)
      ? [new MathFunction({ name: [new MathRun(operator)], children: [] })]
      : convert(base);
  if (sub && sup) {
    return new MathSubSuperScript({
      children: parts,
      subScript: convert(sub),
      superScript: convert(sup),
    });
  }
  if (sub) return new MathSubScript({ children: parts, subScript: convert(sub) });
  return new MathSuperScript({ children: parts, superScript: convert(sup!) });
}

const BRACKETS: Record<string, new (options: { children: MathComponent[] }) => MathComponent> = {
  '(': MathRoundBrackets,
  '[': MathSquareBrackets,
  '{': MathCurlyBrackets,
};

/** `\left( … \right)` — an opening fence, contents, a closing fence. */
function fenced(kids: Element[]): MathComponent[] | null {
  if (kids.length < 2) return null;
  const open = kids[0];
  const close = kids[kids.length - 1];
  if (open.nodeName !== 'mo' || close.nodeName !== 'mo') return null;
  const Bracket = BRACKETS[text(open).trim()];
  if (!Bracket) return null;
  return [new Bracket({ children: sequence(kids.slice(1, -1)) })];
}

/** Rows of cells, separated by commas and semicolons — Word's part is out of the library's reach. */
function matrix(table: Element): MathComponent[] {
  const rows = elements(table).filter((row) => row.nodeName === 'mtr');
  const parts: MathComponent[] = [];
  rows.forEach((row, r) => {
    if (r > 0) parts.push(new MathRun('; '));
    elements(row)
      .filter((cell) => cell.nodeName === 'mtd')
      .forEach((cell, c) => {
        if (c > 0) parts.push(new MathRun(', '));
        parts.push(...children(cell));
      });
  });
  return parts;
}
