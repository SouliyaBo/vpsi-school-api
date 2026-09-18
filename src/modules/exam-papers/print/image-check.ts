import { inflateSync } from 'node:zlib';

/**
 * Whether PDFKit can draw the picture — checked before it is asked to.
 *
 * PDFKit decodes a PNG asynchronously and, handed a damaged one, never
 * finishes: the document's `end` event does not fire and the request waits
 * forever. Word will happily carry such a file. So a picture is inflated
 * here first, where a failure is an exception rather than a hang; a JPEG
 * only needs its markers, since PDFKit embeds it without decoding.
 */
export function isDrawable(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType !== 'image/png') return false;
  return isSoundPng(buffer);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isSoundPng(buffer: Buffer): boolean {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  const data: Buffer[] = [];
  let sawHeader = false;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length > buffer.length) return false;
    if (type === 'IHDR') sawHeader = true;
    if (type === 'IDAT') data.push(buffer.subarray(start, start + length));
    if (type === 'IEND') break;
    offset = start + length + 4;
  }
  if (!sawHeader || data.length === 0) return false;
  try {
    inflateSync(Buffer.concat(data));
    return true;
  } catch {
    return false;
  }
}
