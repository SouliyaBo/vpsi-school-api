import {
  genderFromTitles,
  isPlausibleBirthDate,
  normalizeLao,
  parseEmail,
  parseTeacherDate,
  parseTeacherPhone,
  readAmbiguousBlock,
  splitLaoTitle,
  splitTeachingSubjects,
  stripEnglishTitle,
  stripPlacePrefix,
  type SourceTeacher,
} from './teacher-import.mapper';

/** A row with only the ambiguous block filled in, in sheet order. */
function blockRow(cells: [string, string, string, string, string, string]): SourceTeacher {
  return {
    'ວັນ/ເດືອນ/ປີ ເຂົ້າອົງການ': cells[0],
    ເຊົ່າຫ້ອງຢູ່: cells[1],
    ຢູ່ເຮືອນຕົນເອງ: cells[2],
    'ໂສດ/ແຕ່ງງານ': cells[3],
    ມີລູກຈັກຄົນ: cells[4],
    'ຢູ່ກັບໃຜແດ່(ບອກລະອຽດ)': cells[5],
  };
}

describe('splitLaoTitle', () => {
  it('splits a title written with a space', () => {
    expect(splitLaoTitle('ນ. ສົມເພັດ ພັນໂນລາດ')).toEqual({
      title: 'ນ.',
      name: 'ສົມເພັດ ພັນໂນລາດ',
    });
  });

  it('splits a title glued to the name', () => {
    expect(splitLaoTitle('ທ.ບຸນເຫຼືອ ທໍາມະໂນລາດ').title).toBe('ທ.');
    expect(splitLaoTitle('ທ.ບຸນເຫຼືອ ທໍາມະໂນລາດ').name).toBe(normalizeLao('ບຸນເຫຼືອ ທໍາມະໂນລາດ'));
  });

  it('survives the doubled full stop the register sometimes writes', () => {
    expect(splitLaoTitle('ນ..ລັດເຊຍ ພົມມະຫານ')).toEqual({
      title: 'ນ.',
      name: 'ລັດເຊຍ ພົມມະຫານ',
    });
  });

  it('prefers the longer honorific', () => {
    expect(splitLaoTitle('ນາງ ຂັນແກ້ວ').title).toBe('ນາງ.');
    expect(splitLaoTitle('ທ້າວ ຄຳສົມພູ ສີຫາລາດ').name).toBe('ຄຳສົມພູ ສີຫາລາດ');
  });

  it('leaves a name that merely starts with a title letter alone', () => {
    expect(splitLaoTitle('ນາລຽນ ວົງສາ')).toEqual({ title: null, name: 'ນາລຽນ ວົງສາ' });
  });
});

describe('genderFromTitles', () => {
  it('reads gender from the Lao honorific', () => {
    expect(genderFromTitles('ນ.', null)).toBe('female');
    expect(genderFromTitles('ທ.', null)).toBe('male');
    expect(genderFromTitles('ທ້າວ.', null)).toBe('male');
  });

  it('falls back to the English one', () => {
    expect(genderFromTitles(null, 'Miss Phonethip Vongphachan')).toBe('female');
    expect(genderFromTitles(null, 'Mr Bo souliya')).toBe('male');
    expect(genderFromTitles(null, 'Ms Somphet PHANNOLATH')).toBe('female');
  });

  it('refuses to guess when neither is present', () => {
    expect(genderFromTitles(null, 'Somphet PHANNOLATH')).toBeNull();
  });
});

describe('stripEnglishTitle', () => {
  it('drops the honorific', () => {
    expect(stripEnglishTitle('Mr Beersavanh SITTHIVONG')).toBe('Beersavanh SITTHIVONG');
    expect(stripEnglishTitle('Miss lindar latsavong')).toBe('lindar latsavong');
  });

  it('leaves a name with no honorific untouched', () => {
    expect(stripEnglishTitle('Beersavanh SITTHIVONG')).toBe('Beersavanh SITTHIVONG');
  });
});

describe('splitTeachingSubjects', () => {
  it('splits on the slash', () => {
    expect(splitTeachingSubjects('ເຄມີສາດ/ຊີວະສາດ/ທຳມະຊາດ')).toEqual([
      'ເຄມີສາດ',
      'ຊີວະສາດ',
      'ທຳມະຊາດ',
    ]);
  });

  it('keeps a hyphenated subject whole', () => {
    expect(splitTeachingSubjects('ພາສາລາວ-ວັນນະຄະດີ')).toEqual(['ພາສາລາວ-ວັນນະຄະດີ']);
  });

  it('yields nothing for an empty cell', () => {
    expect(splitTeachingSubjects('')).toEqual([]);
  });
});

describe('normalizeLao', () => {
  it('folds the two spellings of the same vowel', () => {
    expect(normalizeLao('ຄໍາຮຸ່ງ')).toBe('ຄຳຮຸ່ງ');
    expect(normalizeLao('ຄໍາຮຸ່ງ')).toBe(normalizeLao('ຄຳຮຸ່ງ'));
  });
});

describe('stripPlacePrefix', () => {
  it('drops both the abbreviated and spelled-out class word', () => {
    expect(stripPlacePrefix('ບ.ຄໍາຮຸ່ງ')).toBe('ຄຳຮຸ່ງ');
    expect(stripPlacePrefix('ມ. ໝອກ')).toBe('ໝອກ');
    expect(stripPlacePrefix('ເມືອງໄຊທານີ')).toBe('ໄຊທານີ');
  });

  it('folds the three spellings of one district together', () => {
    const spellings = ['ໄຊທານີ', 'ມ.ໄຊທານີ', 'ເມືອງໄຊທານີ'].map(stripPlacePrefix);
    expect(new Set(spellings).size).toBe(1);
  });

  it('leaves a province whose name is not prefixed', () => {
    expect(stripPlacePrefix('ນະຄອນຫຼວງວຽງຈັນ')).toBe('ນະຄອນຫຼວງວຽງຈັນ');
  });
});

describe('parseTeacherPhone', () => {
  it('folds the ways the register writes a number', () => {
    expect(parseTeacherPhone('020 55 529 281')).toBe('02055529281');
    expect(parseTeacherPhone('98311292')).toBe('02098311292');
    expect(parseTeacherPhone('2091567725')).toBe('02091567725');
  });

  it('refuses anything that is not a Lao number', () => {
    expect(parseTeacherPhone('n/a')).toBeNull();
    expect(parseTeacherPhone('')).toBeNull();
  });
});

describe('parseEmail', () => {
  it('lowercases a valid address', () => {
    expect(parseEmail('Vps4slaothip@gmail.com')).toBe('vps4slaothip@gmail.com');
  });

  it('rejects a non-address', () => {
    expect(parseEmail('')).toBeNull();
    expect(parseEmail('not an email')).toBeNull();
  });
});

describe('parseTeacherDate', () => {
  it('reads day-first dates with either separator', () => {
    expect(parseTeacherDate('13/2/1996')?.toISOString()).toBe('1996-02-13T00:00:00.000Z');
    expect(parseTeacherDate('6.8.1999')?.toISOString()).toBe('1999-08-06T00:00:00.000Z');
  });

  it('rejects a day that does not exist in its month', () => {
    expect(parseTeacherDate('31/2/2014')).toBeNull();
  });

  it('rejects prose', () => {
    expect(parseTeacherDate('P')).toBeNull();
    expect(parseTeacherDate('ເຊົ່າຫ້ອງ')).toBeNull();
  });
});

describe('isPlausibleBirthDate', () => {
  const now = new Date('2026-08-10T00:00:00Z');

  it('accepts a working teacher', () => {
    expect(isPlausibleBirthDate(new Date('1994-07-03T00:00:00Z'), now)).toBe(true);
    expect(isPlausibleBirthDate(new Date('1956-01-08T00:00:00Z'), now)).toBe(true);
  });

  it('rejects the transcription slip that makes a teacher a toddler', () => {
    expect(isPlausibleBirthDate(new Date('2024-05-21T00:00:00Z'), now)).toBe(false);
  });
});

describe('readAmbiguousBlock', () => {
  it('reads an unshifted row', () => {
    const block = readAmbiguousBlock(
      blockRow(['12/9/2020', '5/5/2009', 'ເຊົ່າຫ້ອງ', 'ແຕ່ງງານ', '1', 'ເມຍ ແລະ ນ້ອງສາວ']),
    );

    expect(block.housingType).toBe('rented');
    expect(block.maritalStatus).toBe('married');
    expect(block.childrenCount).toBe(1);
    expect(block.livingWith).toBe('ເມຍ ແລະ ນ້ອງສາວ');
    expect(block.unrecognized).toEqual([]);
  });

  it('reads a row whose values slid one column left', () => {
    const block = readAmbiguousBlock(
      blockRow(['12/9/2020', '23/3/2009', '9/2/2011', 'ເຮືອນພໍ່ແມ່', 'ໂສດ', 'ພໍ່,ແມ່,ນ້ອງຊາຍ']),
    );

    expect(block.housingType).toBe('parents');
    expect(block.maritalStatus).toBe('single');
    expect(block.livingWith).toBe('ພໍ່,ແມ່,ນ້ອງຊາຍ');
  });

  it('reads the worst-shifted row, and reports the cell it cannot place', () => {
    const block = readAmbiguousBlock(
      blockRow(['P', '5/5/2023', '7/10/2009', '5/10/2009', 'ເຊົ່າຫ້ອງຢູ່', 'ມີແຟນ']),
    );

    expect(block.housingType).toBe('rented');
    expect(block.maritalStatus).toBe('engaged');
    expect(block.livingWith).toBeNull();
    expect(block.unrecognized).toEqual(['P']);
  });

  it('does not read household prose as housing', () => {
    // `ເອື້ອຍ` appears in both "lives at my sister's" and "lives with my sister",
    // and only the first is a housing answer.
    const block = readAmbiguousBlock(
      blockRow(['', '', 'ຢູ່ເຮືອນເອື້ອຍ', 'ໂສດ', '', 'ຢູ່ກັບເອື້ອຍ,ນ້ອງ,ແລະອ້າຍເຂີຍ']),
    );

    expect(block.housingType).toBe('relatives');
    expect(block.maritalStatus).toBe('single');
    expect(block.livingWith).toBe('ຢູ່ກັບເອື້ອຍ,ນ້ອງ,ແລະອ້າຍເຂີຍ');
  });

  it('takes a bare number as a child count wherever it landed', () => {
    const block = readAmbiguousBlock(
      blockRow(['20/6/2017', '24/3/2012', '3/2/2011', 'ເຮືອນພີ່ນ້ອງ', 'ແຕ່ງງານ', '0']),
    );

    expect(block.housingType).toBe('relatives');
    expect(block.maritalStatus).toBe('married');
    expect(block.childrenCount).toBe(0);
    expect(block.livingWith).toBeNull();
  });

  it('leaves an unreadable abbreviation empty rather than guessing', () => {
    const block = readAmbiguousBlock(
      blockRow(['5.5.2022', '13.12.2014', '16.10.2015', 'ເຮືອນພໍ່ແມ່', 'ສ', 'ພໍ່,ແມ່,ເອື້ອຍ']),
    );

    expect(block.maritalStatus).toBeNull();
    expect(block.childrenCount).toBeNull();
    expect(block.unrecognized).toEqual(['ສ']);
    expect(block.livingWith).toBe('ພໍ່,ແມ່,ເອື້ອຍ');
  });

  it('imports nothing from an empty block', () => {
    const block = readAmbiguousBlock(blockRow(['', '', '', '', '', '']));

    expect(block).toEqual({
      housingType: null,
      maritalStatus: null,
      childrenCount: null,
      livingWith: null,
      unrecognized: [],
    });
  });
});
