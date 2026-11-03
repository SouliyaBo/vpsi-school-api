/**
 * ຕົວຍົກ and ຕົວຫ້ອຍ — superscript and subscript: `3 × 10⁸ m/s`, `H₂O`.
 *
 * Word keeps them as a property of the run (`<w:vertAlign w:val=
 * "superscript"/>`); read as plain characters, `10` with a raised `8` became
 * `108` and a ຟີຊິກ answer changed its value (the office, 20 Oct 2026). Marked
 * in the text as `10[sup]8[/sup]` and `H[sub]2[/sub]O`, like `[u]…[/u]`, in
 * questions and options alike — unlike an underline, a raised figure is never
 * how the right answer is marked.
 *
 * The ready-made characters (² ³ ⁸ ₂ …) are folded into the same markers at
 * upload (`foldUnicodeScripts`): the printer then sets an ordinary figure small
 * and raised, rather than needing a face that happens to have ⁸ — Times New
 * Roman Bold does not.
 *
 * The admin keeps a copy in `features/exam-papers/lib/script.ts`; the two must
 * agree on the markers.
 */

export type Script = 'sup' | 'sub';

const RUN = /\[(sup|sub)\]([\s\S]*?)\[\/\1\]/g;

export interface ScriptPiece {
  text: string;
  script: Script | null;
}

export function hasScript(text: string): boolean {
  RUN.lastIndex = 0;
  return RUN.test(text);
}

/** The text in runs, each raised, lowered or level; an unclosed marker is just text. */
export function splitScript(text: string): ScriptPiece[] {
  const pieces: ScriptPiece[] = [];
  let last = 0;
  RUN.lastIndex = 0;
  for (const match of text.matchAll(RUN)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ text: text.slice(last, index), script: null });
    if (match[2]) pieces.push({ text: match[2], script: match[1] as Script });
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), script: null });
  return pieces;
}

/** For a list that shows a question in one line: `10^8`, `H_2O`. */
export function flattenScript(text: string): string {
  RUN.lastIndex = 0;
  return text.replace(RUN, (_, kind: string, inner: string) =>
    kind === 'sup' ? `^${inner}` : `_${inner}`,
  );
}

/**
 * Characters marked with Word's raised or lowered runs.
 *
 * Each run comes back as one piece of text, markers and all, carrying the
 * underline of its first character — so the underline marking that runs after
 * this treats `10[sup]8[/sup]` as two pieces, never splits a marker, and an
 * underlined `10⁸` stays one underlined run.
 */
export function scriptChars(
  chars: { ch: string; underline: boolean; script: Script | null }[],
): { ch: string; underline: boolean }[] {
  const out: { ch: string; underline: boolean }[] = [];
  let i = 0;
  while (i < chars.length) {
    const { script, underline } = chars[i];
    if (!script || /\s/.test(chars[i].ch)) {
      out.push({ ch: chars[i].ch, underline });
      i += 1;
      continue;
    }
    let text = '';
    while (i < chars.length && chars[i].script === script && !/\s/.test(chars[i].ch)) {
      text += chars[i].ch;
      i += 1;
    }
    out.push({ ch: `[${script}]${text}[/${script}]`, underline });
  }
  return out;
}

// prettier-ignore
const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8',
  '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
};
// prettier-ignore
const SUBSCRIPTS: Readonly<Record<string, string>> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8',
  '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
};

/** Runs of ready-made ² ³ ⁸ ₂ … as the same markers Word's own runs get. */
export function foldUnicodeScripts(text: string): string {
  return text
    .replace(
      /[⁰¹²³⁴-⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g,
      (run) => `[sup]${[...run].map((c) => SUPERSCRIPTS[c]).join('')}[/sup]`,
    )
    .replace(/[₀-₉₊₋₌₍₎]+/g, (run) => `[sub]${[...run].map((c) => SUBSCRIPTS[c]).join('')}[/sub]`);
}

/** `<w:vertAlign>` of a run's properties, when it raises or lowers the run. */
export function scriptOf(vertAlign: string | null | undefined): Script | null {
  if (vertAlign === 'superscript') return 'sup';
  if (vertAlign === 'subscript') return 'sub';
  return null;
}
