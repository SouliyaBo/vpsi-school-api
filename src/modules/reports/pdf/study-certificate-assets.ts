import { Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';

/**
 * Locates the two images the letterhead carries.
 *
 * Both are optional: a missing image leaves a gap rather than failing the
 * render, because a letter without its logo is still a usable document the
 * office can reprint once the file is in place, whereas a failed render on the
 * day a parent is waiting at the counter is not.
 *
 * PDFKit reads **PNG and JPEG only** — no SVG, no WebP. A `.png` file that is
 * really a WebP (which is what most emblem downloads are) throws at draw time,
 * so the extension is not evidence; convert before dropping a file in.
 */
const logger = new Logger('StudyCertificateAssets');

const EMBLEM_CANDIDATES = ['assets/images/lao-emblem.png'];
const SCHOOL_LOGO_CANDIDATES = ['assets/images/school-logo.png'];

export interface LetterheadImages {
  emblem: string | null;
  schoolLogo: string | null;
}

let cached: LetterheadImages | null = null;

function resolve(explicit: string | undefined, candidates: string[], label: string): string | null {
  const configured = explicit?.trim();
  if (configured) {
    if (existsSync(configured)) return configured;
    logger.warn(`${label} path is set but the file does not exist: ${configured}`);
    return null;
  }

  const found = candidates.find((path) => existsSync(path)) ?? null;
  if (!found) logger.warn(`No ${label} image found; the letterhead will render without it`);
  return found;
}

export function resolveLetterheadImages(): LetterheadImages {
  if (cached) return cached;
  cached = {
    emblem: resolve(process.env.PDF_EMBLEM_PATH, EMBLEM_CANDIDATES, 'national emblem'),
    schoolLogo: resolve(process.env.PDF_SCHOOL_LOGO_PATH, SCHOOL_LOGO_CANDIDATES, 'school logo'),
  };
  return cached;
}

/** Test seam — resets the memoized result. */
export function resetLetterheadCache(): void {
  cached = null;
}
