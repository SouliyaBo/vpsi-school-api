import { isDrawable } from './image-check';

const SOUND_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A PNG whose IDAT is not a zlib stream — the kind that hangs PDFKit. */
const DAMAGED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAAA8CAYAAACYPS9rAAAAV0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4G8A8HQAAWq2p7QAAAAASUVORK5CYII=',
  'base64',
);

describe('isDrawable', () => {
  it('accepts a sound PNG and a JPEG by its markers', () => {
    expect(isDrawable(SOUND_PNG, 'image/png')).toBe(true);
    expect(isDrawable(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg')).toBe(true);
  });

  it('refuses a damaged PNG, a mislabelled file, and anything else', () => {
    expect(isDrawable(DAMAGED_PNG, 'image/png')).toBe(false);
    expect(isDrawable(Buffer.from('RIFF....WEBP'), 'image/png')).toBe(false);
    expect(isDrawable(SOUND_PNG, 'image/jpeg')).toBe(false);
    expect(isDrawable(SOUND_PNG, 'image/gif')).toBe(false);
  });
});
