import { hasVerse, splitVerse, unversify, versify, versifyTabs } from './verse';

/** The ມ.5 ພາສາລາວ question the office sent, 20 Oct 2026. */
const PROVERB = '“ສາວບໍ່ມັກອ້າຍ ບໍ່ມັກຕາຍກໍຕາມຊ່າງ ບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ ໃຫ້ຕາມກົ້ນແລ່ນນຳ”';
const BLOCK = '⟪“ສາວບໍ່ມັກອ້າຍ | ບໍ່ມັກຕາຍກໍຕາມຊ່າງ\nບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ | ໃຫ້ຕາມກົ້ນແລ່ນນຳ”⟫';

describe('versify', () => {
  it('cuts a ຄຳຜະຫຍາ at its spaces, two ວັກ to a row', () => {
    expect(versify(PROVERB)).toBe(BLOCK);
  });

  it('gives an odd last ວັກ a row to itself', () => {
    expect(versify('ກ ຂ ຄ')).toBe('⟪ກ | ຂ\nຄ⟫');
  });

  it('keeps the divisions a teacher already typed', () => {
    expect(versify('ກ ກ\tຂ ຂ\nຄ | ງ')).toBe('⟪ກ ກ | ຂ ຂ\nຄ | ງ⟫');
  });
});

describe('splitVerse', () => {
  it('cuts the question into prose and verse, without empty lines round the verse', () => {
    const text = `ຄຳຜະຫຍາທີ່ວ່າ:\n${BLOCK}\nໃຊ້ສິລະປະການປະດິດແຕ່ງແບບໃດ?`;
    expect(splitVerse(text)).toEqual([
      { kind: 'text', text: 'ຄຳຜະຫຍາທີ່ວ່າ:' },
      {
        kind: 'verse',
        rows: [
          ['“ສາວບໍ່ມັກອ້າຍ', 'ບໍ່ມັກຕາຍກໍຕາມຊ່າງ'],
          ['ບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ', 'ໃຫ້ຕາມກົ້ນແລ່ນນຳ”'],
        ],
      },
      { kind: 'text', text: 'ໃຊ້ສິລະປະການປະດິດແຕ່ງແບບໃດ?' },
    ]);
  });

  it('leaves a question with no verse as one piece of text', () => {
    expect(splitVerse('ປະເທດລາວມີຊາຍແດນຮ່ວມກັບຈັກປະເທດ?')).toEqual([
      { kind: 'text', text: 'ປະເທດລາວມີຊາຍແດນຮ່ວມກັບຈັກປະເທດ?' },
    ]);
    expect(hasVerse('ປະເທດລາວ')).toBe(false);
    expect(hasVerse(BLOCK)).toBe(true);
  });
});

describe('unversify', () => {
  it('puts the verse back as the running text it was', () => {
    expect(unversify(`ກ ${BLOCK} ຂ`)).toBe(`ກ ${PROVERB} ຂ`);
  });
});

describe('versifyTabs', () => {
  it('makes the lines a Word file divided with a Tab into one block', () => {
    const fromWord =
      'ຄຳຜະຫຍາທີ່ວ່າ:\nສາວບໍ່ມັກອ້າຍ\tບໍ່ມັກຕາຍກໍຕາມຊ່າງ\nບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ\t\tໃຫ້ຕາມກົ້ນແລ່ນນຳ\nແບບໃດ?';
    expect(versifyTabs(fromWord)).toBe(
      'ຄຳຜະຫຍາທີ່ວ່າ:\n⟪ສາວບໍ່ມັກອ້າຍ | ບໍ່ມັກຕາຍກໍຕາມຊ່າງ\nບໍ່ໄດ້ຫໍ່ຂີ້ຈ້າງ | ໃຫ້ຕາມກົ້ນແລ່ນນຳ⟫\nແບບໃດ?',
    );
  });

  it('turns a Tab that only spaces a line into a space', () => {
    expect(versifyTabs('\tຂໍ້ຄວາມ\t')).toBe(' ຂໍ້ຄວາມ ');
    expect(versifyTabs('ບໍ່ມີ Tab')).toBe('ບໍ່ມີ Tab');
  });
});

describe('splitVerse, with the verse in the middle of a line', () => {
  it('leaves no stray space at the verse’s edges', () => {
    expect(splitVerse('ກ: ⟪ຂ | ຄ⟫ ງ?')).toEqual([
      { kind: 'text', text: 'ກ:' },
      { kind: 'verse', rows: [['ຂ', 'ຄ']] },
      { kind: 'text', text: 'ງ?' },
    ]);
  });
});
