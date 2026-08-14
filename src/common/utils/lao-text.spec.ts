import { laoSpellingVariants, stripInvisible } from './lao-text';

/**
 * Both cases here came off the school's own roll sheets, and both are invisible
 * on screen — which is why they reached the database in the first place.
 */
describe('stripInvisible', () => {
  it('removes the zero-width spaces a pasted cell carries', () => {
    const pasted = 'ນະ​ຄອນຫຼວງວຽງ​ຈັນ';
    expect(pasted).not.toBe('ນະຄອນຫຼວງວຽງຈັນ');
    expect(stripInvisible(pasted)).toBe('ນະຄອນຫຼວງວຽງຈັນ');
  });

  it('leaves ordinary text alone', () => {
    expect(stripInvisible('ໜອງປາໄນ')).toBe('ໜອງປາໄນ');
  });

  it('does not touch spelling, only invisible characters', () => {
    // The vowel is left exactly as typed — folding it here would rewrite what
    // gets stored, which is not this function's job.
    expect(stripInvisible('ດ່ານຄໍາ')).toBe('ດ່ານຄໍາ');
  });
});

describe('laoSpellingVariants', () => {
  it('offers both spellings of ຳ, whichever way it was typed', () => {
    expect(laoSpellingVariants('ດ່ານຄໍາ')).toEqual(['ດ່ານຄໍາ', 'ດ່ານຄຳ']);
    expect(laoSpellingVariants('ຄຳຮຸ່ງ')).toEqual(['ຄຳຮຸ່ງ', 'ຄໍາຮຸ່ງ']);
  });

  it('puts the name as written first, so a new record keeps the school spelling', () => {
    expect(laoSpellingVariants('ດ່ານຄໍາ')[0]).toBe('ດ່ານຄໍາ');
  });

  it('finds a place stored either way', () => {
    // The point of the whole thing: earlier imports stored one spelling and
    // later sheets write the other, and they have to meet.
    const [written] = laoSpellingVariants('ຄໍາຮຸ່ງ');
    expect(laoSpellingVariants('ຄຳຮຸ່ງ')).toContain(written);
  });

  it('yields one entry for a name with no ຳ in it', () => {
    expect(laoSpellingVariants('ໜອງປາໄນ')).toEqual(['ໜອງປາໄນ']);
  });

  it('cleans invisible characters before offering variants', () => {
    expect(laoSpellingVariants('ນະ​ຄອນຫຼວງວຽງ​ຈັນ')).toEqual(['ນະຄອນຫຼວງວຽງຈັນ']);
  });

  it('ignores an empty cell', () => {
    expect(laoSpellingVariants('   ')).toEqual([]);
  });
});
