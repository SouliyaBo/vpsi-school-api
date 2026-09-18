import sharp from 'sharp';

/**
 * The photograph as the reader wants it: upright, no larger than it needs
 * to be, and one grey byte per pixel.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** Row-major, one byte per pixel, 0 = black. */
  data: Uint8Array;
}

/** Longest side of the working image. Bubbles are ~4 px across per 500 px of page width. */
export const WORKING_SIZE = 1800;

export interface PreparedPhoto {
  gray: GrayImage;
  /** The same image as a JPEG — what the review page shows under its overlay. */
  jpeg: Buffer;
}

/**
 * Applies the camera's orientation tag, shrinks to `WORKING_SIZE`, and keeps
 * a JPEG of exactly what was analysed so the overlay drawn on the review page
 * lands on the same pixels the decisions were made from.
 */
export async function preparePhoto(buffer: Buffer): Promise<PreparedPhoto> {
  const upright = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: WORKING_SIZE, height: WORKING_SIZE, fit: 'inside', withoutEnlargement: true });
  const jpeg = await upright.clone().jpeg({ quality: 82 }).toBuffer();
  const { data, info } = await sharp(jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
  return {
    gray: { width: info.width, height: info.height, data: new Uint8Array(data) },
    jpeg,
  };
}

/** Grey at (x, y), clamped to the image, bilinear between pixels. */
export function sampleGray(image: GrayImage, x: number, y: number): number {
  const cx = Math.min(image.width - 1.001, Math.max(0, x));
  const cy = Math.min(image.height - 1.001, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (px: number, py: number) => image.data[py * image.width + px];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Black-or-white by comparison with the neighbourhood, so a shadow across
 * half the page does not turn that half black. `window` is the side of the
 * neighbourhood in pixels; `bias` how much darker than it a pixel must be.
 */
export function adaptiveThreshold(image: GrayImage, window: number, bias: number): Uint8Array {
  const { width, height, data } = image;
  // Integral image with a one-pixel border of zeros.
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    for (let x = 1; x <= width; x += 1) {
      row += data[(y - 1) * width + (x - 1)];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
    }
  }
  const half = Math.max(1, Math.floor(window / 2));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum =
        integral[y1 * stride + x1] -
        integral[y0 * stride + x1] -
        integral[y1 * stride + x0] +
        integral[y0 * stride + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      out[y * width + x] = data[y * width + x] < mean - bias ? 1 : 0;
    }
  }
  return out;
}

export interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  cx: number;
  cy: number;
}

/** Connected components of the black pixels, 4-connected, with their boxes. */
export function findBlobs(
  binary: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Blob[] {
  const labels = new Int32Array(width * height);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || labels[start]) continue;
    const label = next++;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbours = [index - 1, index + 1, index - width, index + width];
      if (x === 0) neighbours[0] = -1;
      if (x === width - 1) neighbours[1] = -1;
      for (const n of neighbours) {
        if (n < 0 || n >= binary.length || !binary[n] || labels[n]) continue;
        labels[n] = label;
        stack.push(n);
      }
    }
    if (area >= minArea) {
      blobs.push({ minX, minY, maxX, maxY, area, cx: sumX / area, cy: sumY / area });
    }
  }
  return blobs;
}
