/**
 * Reading Lao text that was typed by many hands into many spreadsheets.
 *
 * Two things make the same Lao word arrive as different strings, and both are
 * invisible on screen — which is exactly why they survive proofreading and only
 * surface as a village that exists twice.
 */

/**
 * Characters that occupy no space and mean nothing here.
 *
 * Word-processor line-breaking hints (`U+200B` and friends) and the byte-order
 * mark ride along when a cell is pasted between applications. The school's own
 * roll sheet arrived with `ນະ‌ຄອນຫຼວງວຽງ‌ຈັນ` — the capital city, with two zero-width
 * spaces buried in it, which matches nothing already on file.
 */
const INVISIBLE = /[​-‍﻿]/g;

/**
 * `ຳ` written as one character (`U+0EB3`) and as two (`U+0ECD` `U+0EB2`).
 *
 * They render identically and mean the same vowel, but Unicode declares no
 * equivalence between them, so `NFC` will not fold them and a database sees two
 * different words.
 */
const AM_COMPOSED = 'ຳ';
const AM_DECOMPOSED = 'ໍາ';

/** Strips what should never have been in the cell, without altering spelling. */
export function stripInvisible(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE, '');
}

/**
 * The ways this name could already be spelled on file.
 *
 * Used to *look up* rather than to rewrite. The register holds both spellings of
 * `ຳ` — earlier imports stored `ດ່ານຄໍາ` decomposed and `ຄຳຮຸ່ງ` composed — so
 * normalising on the way in would not unify them; it would split them further by
 * making today's spelling miss yesterday's row. Searching for every spelling
 * finds the existing place whichever way it was typed, and leaves what is stored
 * alone.
 *
 * Ordered with the name as given first, so a caller creating a new record uses
 * the school's own spelling.
 */
export function laoSpellingVariants(value: string): string[] {
  const base = stripInvisible(value).trim();
  const variants = [
    base,
    base.replaceAll(AM_DECOMPOSED, AM_COMPOSED),
    base.replaceAll(AM_COMPOSED, AM_DECOMPOSED),
  ];
  return [...new Set(variants.filter(Boolean))];
}

/**
 * Places the school writes both in full and in short.
 *
 * `ນະຄອນຫຼວງ` — "the capital" — is how three of the roll sheets name Vientiane
 * Capital, which the others write out as `ນະຄອນຫຼວງວຽງຈັນ`. Left unmapped they
 * become two provinces, and every village entered under the short form hangs off
 * the wrong one, permanently separated from its own district.
 *
 * Only unambiguous shortenings belong here. `ວຽງຈັນ` deliberately does not: it is
 * the province *around* the capital, a different place with its own districts.
 */
const PROVINCE_ALIASES: Record<string, string> = {
  ນະຄອນຫຼວງ: 'ນະຄອນຫຼວງວຽງຈັນ',
  ນະຄອນຫລວງ: 'ນະຄອນຫຼວງວຽງຈັນ',
};

/**
 * Every name a province might already be stored under, including the spelled-out
 * form of a shortening. Used to look up, never to rewrite.
 */
export function provinceLookupNames(value: string): string[] {
  const variants = laoSpellingVariants(value);
  const expanded = variants.flatMap((name) => {
    const full = PROVINCE_ALIASES[name];
    return full ? [name, ...laoSpellingVariants(full)] : [name];
  });
  return [...new Set(expanded)];
}
