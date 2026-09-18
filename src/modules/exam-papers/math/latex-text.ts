/**
 * Formulas inside question text.
 *
 * A formula is written the way a maths teacher writes one anywhere else:
 * LaTeX between dollar signs — `ໃຫ້ $x=\sqrt{5}$ ແລ້ວ …` — and `$$…$$` for
 * one set large (displaystyle). That is the form stored in the paper, the
 * form the review page shows and the teacher edits, and the form the
 * printer typesets. Everything a Word file can hold — a Word equation, a
 * MathType equation the teacher converted to TeX — is turned into this
 * first.
 */

export interface TextPart {
  kind: 'text';
  text: string;
}

export interface MathPart {
  kind: 'math';
  tex: string;
  display: boolean;
  /** The part as it stood in the text, `$…$` and all — printed when the TeX is bad. */
  source: string;
}

export type Part = TextPart | MathPart;

/** `$$…$$` first, so a display formula is not read as two empty inline ones. */
const MATH_PART = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;

/** Splits text into its words and its formulas, in order. */
export function splitMath(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  MATH_PART.lastIndex = 0;
  for (const match of text.matchAll(MATH_PART)) {
    const index = match.index!;
    const display = match[1] !== undefined;
    const tex = (match[1] ?? match[2]).trim();
    if (!tex) continue;
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) });
    parts.push({ kind: 'math', tex, display, source: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** True when the text holds at least one formula. */
export function hasMath(text: string): boolean {
  MATH_PART.lastIndex = 0;
  return MATH_PART.test(text);
}

/**
 * The other TeX delimiters as the dollar forms: `\( … \)` is inline,
 * `\[ … \]` is display. MathType's converter writes both.
 */
export function normaliseMathDelimiters(text: string): string {
  return text
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, tex: string) => `$$${tex}$$`)
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, tex: string) => `$${tex}$`);
}

/**
 * MathType's "Convert Equations → TeX" leaves its own record of each
 * equation in front of the TeX, as comment lines:
 *
 *     % MathType!MTEF!2!1!+-
 *     % feaagKart1ev2aaatCvAUfeBSjuyZL2yd9gzLbvyNv2CaerbuLwBLn
 *     % …!3A6B!
 *     $x = \sqrt 5 $
 *
 * A line that is a TeX comment is dropped. Returns the text without them
 * and whether the text *ended* in one — in which case what Word put in the
 * next paragraph is the rest of this sentence.
 */
export function stripTexComments(text: string): { text: string; endedInComment: boolean } {
  const lines = text.split('\n');
  let endedInComment = false;
  const kept: string[] = [];
  for (const line of lines) {
    const index = line.search(/(?:^|\s)%\s*MathType!|^\s*%/);
    if (index < 0) {
      kept.push(line);
      endedInComment = false;
      continue;
    }
    const before = line.slice(0, index).trimEnd();
    if (before) kept.push(before);
    endedInComment = true;
  }
  return { text: kept.join('\n'), endedInComment };
}
