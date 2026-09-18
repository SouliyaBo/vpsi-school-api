import { Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

/**
 * WMF and EMF pictures, turned into PNG so they can be printed.
 *
 * A Word file written with MathType carries every equation as an OLE object
 * whose visible form is a Windows metafile — a list of drawing commands, not
 * an image — and the PDF printer draws PNG and JPEG only. LibreOffice reads
 * metafiles well (fonts and all, substituting where MathType's own are not
 * installed), so it is asked to draw each one.
 *
 * It draws the metafile onto a whole page, fitted into a box in the middle,
 * and the box is what matters: it is the metafile's own canvas — the size
 * Word shows the equation at, padding and all — so cutting the box out and
 * printing it at Word's size puts the equation on the page at exactly the
 * size the teacher saw. (Trimming to the ink instead, then scaling to Word's
 * height, blows a short equation up: `-30` has more padding than a fraction.)
 * The box's place on the page comes from a first, cheap pass that writes SVG.
 *
 * The page is drawn large enough that the box holds about a thousand dots
 * per printed inch. LibreOffice encodes JPEG twice as fast as PNG, and at
 * quality 95 on a white page with black ink the difference does not survive
 * the crop; the crop is re-encoded as PNG. Two or more LibreOffice processes
 * run side by side when the machine has the cores: a paper of 140 equations
 * takes about a minute on two.
 */

const execFileAsync = promisify(execFile);
const logger = new Logger('MetafileConverter');

const CANDIDATES = [
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/lib/libreoffice/program/soffice',
  '/usr/lib64/libreoffice/program/soffice',
  '/opt/libreoffice/program/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];

/** Width of the drawn page in pixels; the height follows the page's shape. */
const PAGE_WIDTH_PX = 4800;
const JPEG_QUALITY = 95;
/** How many pictures one LibreOffice run is handed. */
const BATCH = 80;
const MAX_PROCESSES = 4;
const TIMEOUT_MS = 5 * 60 * 1000;

let resolved: string | null | undefined;

/** The LibreOffice binary, if there is one — `LIBREOFFICE_PATH` first. */
export function metafileConverterPath(): string | null {
  if (resolved !== undefined) return resolved;
  const explicit = process.env.LIBREOFFICE_PATH?.trim();
  if (explicit) {
    if (!existsSync(explicit)) logger.warn(`LIBREOFFICE_PATH does not exist: ${explicit}`);
    resolved = existsSync(explicit) ? explicit : null;
    return resolved;
  }
  resolved = CANDIDATES.find((path) => existsSync(path)) ?? null;
  if (!resolved) {
    logger.warn(
      'LibreOffice not found — WMF/EMF pictures (MathType equations) in uploaded papers will be ' +
        'left out. Install it, or set LIBREOFFICE_PATH.',
    );
  }
  return resolved;
}

export interface MetafileInput {
  id: string;
  buffer: Buffer;
  extension: 'wmf' | 'emf';
}

export interface ConvertedMetafile {
  png: Buffer;
  widthPx: number;
  heightPx: number;
  /**
   * True when the picture is the metafile's whole canvas, to be printed at
   * the size Word gave it; false when it is the ink alone (the canvas could
   * not be found) and the caller must pick a size.
   */
  canvas: boolean;
}

/** Where LibreOffice put the drawing on its page, in the page's own units. */
interface Placement {
  page: { width: number; height: number };
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Converts the batch; a picture LibreOffice could not draw is simply absent
 * from the result, and the caller says so for that one alone.
 */
export async function convertMetafiles(
  inputs: MetafileInput[],
): Promise<Map<string, ConvertedMetafile>> {
  const out = new Map<string, ConvertedMetafile>();
  const soffice = metafileConverterPath();
  if (!soffice || inputs.length === 0) return out;

  const dir = await mkdtemp(join(tmpdir(), 'vpsi-metafile-'));
  try {
    const inDir = join(dir, 'in');
    const svgDir = join(dir, 'svg');
    const rasterDir = join(dir, 'raster');
    await Promise.all([svgDir, rasterDir, inDir].map((d) => mkdir(d, { recursive: true })));
    await Promise.all(
      inputs.map((input) => writeFile(join(inDir, `${input.id}.${input.extension}`), input.buffer)),
    );
    const files = inputs.map((input) => join(inDir, `${input.id}.${input.extension}`));

    // Pass 1, vector: the page and the drawing's box on it. Fast — a few
    // seconds for a hundred pictures.
    await runConversions(soffice, dir, 'svg', 'svg', svgDir, files);
    const placements = new Map<string, Placement>();
    for (const input of inputs) {
      const placement = await readPlacement(join(svgDir, `${input.id}.svg`));
      if (placement) placements.set(input.id, placement);
    }

    // Pass 2, raster. Every page in the batch has the same shape (it is the
    // default Draw page), so one pixel size serves all.
    const shape = placements.values().next().value?.page ?? { width: 21000, height: 29700 };
    const pixels = {
      width: PAGE_WIDTH_PX,
      height: Math.round((PAGE_WIDTH_PX * shape.height) / shape.width),
    };
    const filter =
      'jpg:draw_jpg_Export:' +
      JSON.stringify({
        PixelWidth: { type: 'long', value: String(pixels.width) },
        PixelHeight: { type: 'long', value: String(pixels.height) },
        Quality: { type: 'long', value: String(JPEG_QUALITY) },
      });
    await runConversions(soffice, dir, filter, 'jpg', rasterDir, files);

    for (const input of inputs) {
      try {
        const page = await readFile(join(rasterDir, `${input.id}.jpg`));
        // A canvas too small to be one (a metafile with no placeable
        // header lands as a dot) falls back to the ink.
        const placement = placements.get(input.id);
        const converted =
          (placement && (await cropCanvas(page, placement, pixels))) ?? (await trimInk(page));
        if (converted) out.set(input.id, converted);
      } catch {
        // Not produced, or blank — the caller warns about this picture.
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return out;
}

/**
 * Runs LibreOffice over the files in batches, several batches at once when
 * there are cores for it. Each process gets a profile of its own: a shared
 * one is locked by any other LibreOffice, including a second upload.
 */
async function runConversions(
  soffice: string,
  dir: string,
  filter: string,
  extension: string,
  outDir: string,
  files: string[],
): Promise<void> {
  const processes = Math.max(1, Math.min(MAX_PROCESSES, availableParallelism()));
  const batchSize = Math.max(1, Math.min(BATCH, Math.ceil(files.length / processes)));
  const batches: string[][] = [];
  for (let start = 0; start < files.length; start += batchSize) {
    batches.push(files.slice(start, start + batchSize));
  }

  let next = 0;
  const worker = async (slot: number) => {
    const profile = join(dir, `profile-${slot}`);
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        await execFileAsync(
          soffice,
          [
            '--headless',
            '--norestore',
            `-env:UserInstallation=file://${profile}`,
            '--convert-to',
            filter,
            '--outdir',
            outDir,
            ...batch,
          ],
          { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
        );
      } catch (error) {
        logger.warn(
          `LibreOffice failed on a batch of ${batch.length} (${extension}): ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(processes, batches.length) }, (_, slot) => worker(slot)),
  );
}

/**
 * The page's `viewBox` and the drawing's `BoundingBox` rect from LibreOffice's
 * SVG, both in hundredths of a millimetre.
 */
async function readPlacement(path: string): Promise<Placement | null> {
  let svg: string;
  try {
    svg = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const viewBox = /<svg[^>]*\bviewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  const rect = /<rect class="BoundingBox"[^>]*/.exec(svg);
  if (!viewBox || !rect) return null;
  const attribute = (name: string) => {
    const match = new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(rect[0]);
    return match ? Number(match[1]) : NaN;
  };
  const box = {
    x: attribute('x'),
    y: attribute('y'),
    width: attribute('width'),
    height: attribute('height'),
  };
  const page = { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  if ([box.width, box.height, page.width, page.height].some((n) => !(n > 0))) return null;
  if (!(box.x >= 0) || !(box.y >= 0)) return null;
  return { page, box };
}

/** Cuts the drawing's canvas out of the page, a pixel outward on each side. */
async function cropCanvas(
  page: Buffer,
  placement: Placement,
  pixels: { width: number; height: number },
): Promise<ConvertedMetafile | null> {
  const scaleX = pixels.width / placement.page.width;
  const scaleY = pixels.height / placement.page.height;
  const left = Math.max(0, Math.floor(placement.box.x * scaleX) - 1);
  const top = Math.max(0, Math.floor(placement.box.y * scaleY) - 1);
  const right = Math.min(
    pixels.width,
    Math.ceil((placement.box.x + placement.box.width) * scaleX) + 1,
  );
  const bottom = Math.min(
    pixels.height,
    Math.ceil((placement.box.y + placement.box.height) * scaleY) + 1,
  );
  if (right - left < 4 || bottom - top < 4) return null;
  const { data, info } = await sharp(page)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: data, widthPx: info.width, heightPx: info.height, canvas: true };
}

/** Without a placement: keep the ink, with a hair of margin so nothing is clipped. */
async function trimInk(page: Buffer): Promise<ConvertedMetafile | null> {
  const { data, info } = await sharp(page)
    .flatten({ background: '#ffffff' })
    .trim({ threshold: 12 })
    .extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#ffffff' })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (info.width < 4 || info.height < 4) return null;
  return { png: data, widthPx: info.width, heightPx: info.height, canvas: false };
}
