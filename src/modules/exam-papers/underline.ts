/**
 * ຂີດກ້ອງ in a question — the word a ພາສາລາວ question asks about, as in
 * "ປ້າຂອງຂ້ອຍພວມໄປຕະຫຼາດ — ສ່ວນທີ່ຂີດກ້ອງ…" with ພວມ underlined — printed
 * underlined.
 *
 * Marked in the question text as `[u]ພວມ[/u]`, like the verse markers in
 * `verse.ts`: no new field, and the teacher can see and edit it. The upload
 * keeps the underline a Word file gave a question's words (`underlineChars`);
 * the review page's ຂີດກ້ອງ button adds and removes it.
 *
 * Questions only. In the options an underline is how a teacher marks the right
 * answer, and the parser reads it as that — see `judgeAnswer`.
 *
 * Asked for by the office on 20 Oct 2026, after the upload dropped the
 * underlines a ພາສາລາວ paper's questions turned on.
 *
 * The admin keeps a copy in `features/exam-papers/lib/underline.ts`; the two
 * must agree on the markers.
 */

export const UNDERLINE_OPEN = '[u]';
export const UNDERLINE_CLOSE = '[/u]';

const RUN = /\[u\]([\s\S]*?)\[\/u\]/g;

export interface MarkedPiece {
  text: string;
  underline: boolean;
}

export function hasUnderline(text: string): boolean {
  RUN.lastIndex = 0;
  return RUN.test(text);
}

/** The text in runs, each underlined or not; a marker left unclosed is just text. */
export function splitUnderline(text: string): MarkedPiece[] {
  const pieces: MarkedPiece[] = [];
  let last = 0;
  RUN.lastIndex = 0;
  for (const match of text.matchAll(RUN)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ text: text.slice(last, index), underline: false });
    if (match[1]) pieces.push({ text: match[1], underline: true });
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), underline: false });
  return pieces;
}

/** The words without their markers — for a list showing a question in brief. */
export function stripUnderline(text: string): string {
  RUN.lastIndex = 0;
  return text.replace(RUN, '$1');
}

/**
 * Characters joined into text with their underlined runs marked.
 *
 * A run starts and ends on a printed character: a space, Tab or line break at
 * its edge is left outside, and a line break or Tab inside ends it, so a run
 * never spans two rows of a ຄຳກອນ or two lines of a question.
 */
export function underlineChars(chars: { ch: string; underline: boolean }[]): string {
  let out = '';
  let open = false;
  let pending = '';
  for (const { ch, underline } of chars) {
    const isSpace = ch === ' ' || ch === ' ';
    const isBreak = ch === '\n' || ch === '\t';
    if (open && underline && isSpace) {
      pending += ch;
      continue;
    }
    if (open && (!underline || isBreak)) {
      out += UNDERLINE_CLOSE + pending;
      pending = '';
      open = false;
    } else if (open) {
      out += pending;
      pending = '';
    }
    if (!open && underline && !isSpace && !isBreak) {
      out += UNDERLINE_OPEN;
      open = true;
    }
    out += ch;
  }
  if (open) out += UNDERLINE_CLOSE + pending;
  return out;
}
