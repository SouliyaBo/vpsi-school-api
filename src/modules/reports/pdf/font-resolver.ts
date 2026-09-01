import { Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';

/**
 * Locates a TrueType font that can render Lao script.
 *
 * This matters more than it looks: PDFKit's built-in fonts (Helvetica, Times…)
 * use WinAnsi encoding and have **no Lao glyphs at all**. Rendering
 * "ໃບລາຍງານຜົນການຮຽນ" with them produces blank boxes or mangled output — a
 * report that looks generated but is unreadable. So a Lao-capable TTF is a hard
 * requirement, not a nicety, and report generation fails loudly without one
 * rather than emitting a broken PDF.
 *
 * Resolution order:
 *   1. `PDF_FONT_PATH` / `PDF_FONT_BOLD_PATH` — explicit, wins always
 *   2. the paths where the Docker image installs Noto Sans Lao
 *   3. common system locations, so `npm run start:dev` works on a dev machine
 */
const REGULAR_CANDIDATES = [
  // Alpine/Debian package layout used by the Dockerfile.
  '/usr/share/fonts/noto/NotoSansLao-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansLao-Regular.ttf',
  '/usr/share/fonts/TTF/NotoSansLao-Regular.ttf',
  // Bundled with the repo, if an operator drops one in.
  'assets/fonts/NotoSansLao-Regular.ttf',
  // macOS.
  '/System/Library/Fonts/Supplemental/NotoSansLao.ttc',
  '/Library/Fonts/NotoSansLao-Regular.ttf',
  '/System/Library/Fonts/Supplemental/LaoSangamMN.ttc',
  // Windows.
  'C:\\Windows\\Fonts\\Phetsarath.ttf',
  'C:\\Windows\\Fonts\\LeelaUIb.ttf',
];

/**
 * Deliberately NOT in the list above: Arial Unicode MS
 * (`/System/Library/Fonts/Supplemental/Arial Unicode.ttf`).
 *
 * It has glyphs for every Lao code point, so it looks like a valid choice — but
 * it carries no OpenType layout tables at all. Lao combining vowels and tone
 * marks therefore receive a full advance width instead of being positioned over
 * their base consonant, and text renders as "ຜ ົ ນ" rather than "ຜົນ". That is
 * worse than no font: the PDF looks plausible and is wrong.
 *
 * It can still be forced with `PDF_FONT_PATH` for a rough local preview; the
 * shaping check below will warn.
 */

const BOLD_CANDIDATES = [
  '/usr/share/fonts/noto/NotoSansLao-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansLao-Bold.ttf',
  '/usr/share/fonts/TTF/NotoSansLao-Bold.ttf',
  'assets/fonts/NotoSansLao-Bold.ttf',
  '/Library/Fonts/NotoSansLao-Bold.ttf',
];

export interface ResolvedFonts {
  regular: string;
  /** Falls back to `regular` when no bold face is available. */
  bold: string;
}

export class LaoFontUnavailableError extends Error {
  constructor() {
    super(
      'No Lao-capable font found. PDF generation cannot render Lao text without one. ' +
        'Set PDF_FONT_PATH to a TrueType font containing Lao glyphs (e.g. Noto Sans Lao), ' +
        'or place one at assets/fonts/NotoSansLao-Regular.ttf. ' +
        'The Docker image installs it automatically.',
    );
    this.name = 'LaoFontUnavailableError';
  }
}

const logger = new Logger('LaoFontResolver');

let cached: ResolvedFonts | null = null;

function firstExisting(candidates: string[]): string | null {
  return candidates.find((path) => existsSync(path)) ?? null;
}

/**
 * Resolves the fonts once and caches the result — `existsSync` on a dozen paths
 * per generated page would be wasteful, and the filesystem does not change under
 * a running process.
 */
export function resolveLaoFonts(): ResolvedFonts {
  if (cached) return cached;

  const explicitRegular = process.env.PDF_FONT_PATH?.trim();
  const explicitBold = process.env.PDF_FONT_BOLD_PATH?.trim();

  // An explicitly configured path that does not exist is a misconfiguration, so
  // say so rather than silently searching elsewhere.
  if (explicitRegular && !existsSync(explicitRegular)) {
    throw new Error(`PDF_FONT_PATH points at a file that does not exist: ${explicitRegular}`);
  }

  const regular = explicitRegular ?? firstExisting(REGULAR_CANDIDATES);
  if (!regular) throw new LaoFontUnavailableError();

  const bold =
    (explicitBold && existsSync(explicitBold) ? explicitBold : null) ??
    firstExisting(BOLD_CANDIDATES) ??
    regular;

  if (bold === regular) {
    logger.warn(`No bold Lao face found; headings will use the regular weight (${regular})`);
  }

  assertShapesLao(regular);

  logger.log(`Lao fonts resolved — regular: ${regular}, bold: ${bold}`);
  cached = { regular, bold };
  return cached;
}

/**
 * Warns when a font has glyphs for Lao but cannot *position* its combining marks.
 *
 * Having the glyphs is not enough. A Lao vowel like ົ (U+0EBB) must sit above its
 * base consonant with **zero advance width**; a font without OpenType layout
 * tables gives it a normal advance and the text comes out as separate characters.
 * Checking here means a bad font produces one loud warning at startup rather than
 * a stack of quietly malformed report cards.
 */
function assertShapesLao(fontPath: string): void {
  try {
    // Required lazily: fontkit is pdfkit's own dependency and only needed here.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fontkit = require('fontkit') as {
      openSync: (path: string) => {
        familyName?: string;
        layout: (text: string) => { positions: { xAdvance: number }[] };
      };
    };

    const font = fontkit.openSync(fontPath);
    // ຜ + ົ (base consonant plus an above-base vowel).
    const run = font.layout('ຜົ');
    const markAdvance = run.positions[1]?.xAdvance ?? 0;

    if (markAdvance > 0) {
      logger.warn(
        `Font "${font.familyName ?? fontPath}" has Lao glyphs but no mark positioning ` +
          `(the combining vowel U+0EBB advances by ${markAdvance}). Lao text will render ` +
          'with detached vowels and tone marks. Install Noto Sans Lao — the Docker image ' +
          'does this automatically — or place it at assets/fonts/NotoSansLao-Regular.ttf.',
      );
    }
  } catch {
    // A failed check must not stop report generation; the render itself will
    // surface a genuinely unusable font.
  }
}

// ── The official face ───────────────────────────────────────────────────────

/**
 * Phetsarath OT — the Lao government's own typeface, by the Ministry of Posts
 * and Telecommunications.
 *
 * Letters the school signs and hands to another office are set in it because
 * that is what an official Lao document looks like; Noto Sans Lao is correct
 * and legible but reads as a web font on paper.
 *
 * It also **contains Lao digits and ASCII digits**, which Noto Sans Lao does
 * not. That is why `coversDigits` is reported rather than assumed: with
 * Phetsarath a date and a telephone number are set in the same face as the words
 * around them, and with the Noto fallback they have to be handed to Helvetica
 * mid-line. What it has no glyphs for is the **Latin alphabet**, so a Latin word
 * still needs Helvetica either way.
 */
const OFFICIAL_CANDIDATES = [
  'assets/fonts/Phetsarath-Regular.ttf',
  'assets/fonts/Phetsarath-OT.ttf',
  '/usr/share/fonts/phetsarath/Phetsarath-Regular.ttf',
  '/usr/share/fonts/truetype/phetsarath/Phetsarath-Regular.ttf',
  '/Library/Fonts/Phetsarath-Regular.ttf',
  '/Library/Fonts/Phetsarath OT.ttf',
  'C:\\Windows\\Fonts\\Phetsarath.ttf',
];

const OFFICIAL_BOLD_CANDIDATES = [
  'assets/fonts/Phetsarath-Bold.ttf',
  '/usr/share/fonts/phetsarath/Phetsarath-Bold.ttf',
  '/usr/share/fonts/truetype/phetsarath/Phetsarath-Bold.ttf',
  '/Library/Fonts/Phetsarath-Bold.ttf',
];

export interface OfficialFonts extends ResolvedFonts {
  /** Whether digits can be set in this face rather than handed to Helvetica. */
  coversDigits: boolean;
}

let cachedOfficial: OfficialFonts | null = null;

/**
 * The face for documents the school signs. Falls back to whatever
 * `resolveLaoFonts` finds, so a missing Phetsarath costs the letter its official
 * look and not its existence.
 */
export function resolveOfficialLaoFonts(): OfficialFonts {
  if (cachedOfficial) return cachedOfficial;

  const explicit = process.env.PDF_OFFICIAL_FONT_PATH?.trim();
  if (explicit && !existsSync(explicit)) {
    throw new Error(`PDF_OFFICIAL_FONT_PATH points at a file that does not exist: ${explicit}`);
  }

  const regular = explicit ?? firstExisting(OFFICIAL_CANDIDATES);

  if (!regular) {
    const fallback = resolveLaoFonts();
    logger.warn(
      'Phetsarath OT not found — official letters will be set in ' +
        `${fallback.regular} instead. Place Phetsarath-Regular.ttf in assets/fonts/ ` +
        'or set PDF_OFFICIAL_FONT_PATH.',
    );
    cachedOfficial = { ...fallback, coversDigits: false };
    return cachedOfficial;
  }

  const explicitBold = process.env.PDF_OFFICIAL_FONT_BOLD_PATH?.trim();
  const bold =
    (explicitBold && existsSync(explicitBold) ? explicitBold : null) ??
    firstExisting(OFFICIAL_BOLD_CANDIDATES) ??
    regular;

  assertShapesLao(regular);

  logger.log(`Official Lao font resolved — regular: ${regular}, bold: ${bold}`);
  cachedOfficial = { regular, bold, coversDigits: true };
  return cachedOfficial;
}

/** Whether a report can be rendered at all. Used by the readiness probe. */
export function isLaoFontAvailable(): boolean {
  try {
    resolveLaoFonts();
    return true;
  } catch {
    return false;
  }
}

/** Test seam — resets the memoized results. */
export function resetFontCache(): void {
  cached = null;
  cachedOfficial = null;
}
