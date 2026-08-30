import { flattenOfficialLocations, looseKey, matchOfficial } from './location-matching';
import type { OfficialLocation } from './location-matching';

/** The nine districts of Vientiane Capital, as the official list spells them. */
const districts = (): OfficialLocation[] =>
  flattenOfficialLocations().filter((row) => row.type === 'district' && row.parentCode === '01');

const villagesOf = (districtCode: string): OfficialLocation[] =>
  flattenOfficialLocations().filter(
    (row) => row.type === 'village' && row.parentCode === districtCode,
  );

const provinces = (): OfficialLocation[] =>
  flattenOfficialLocations().filter((row) => row.type === 'province');

describe('flattenOfficialLocations', () => {
  it('carries the whole official list', () => {
    const flat = flattenOfficialLocations();
    expect(flat.filter((row) => row.type === 'province')).toHaveLength(18);
    expect(flat.filter((row) => row.type === 'district')).toHaveLength(149);
    expect(flat.filter((row) => row.type === 'village')).toHaveLength(488);
  });

  it('keys every row by a code that extends its parent’s', () => {
    for (const row of flattenOfficialLocations()) {
      if (row.parentCode) expect(row.code.startsWith(row.parentCode)).toBe(true);
    }
  });

  it('villages are Vientiane Capital only — the source list goes no further', () => {
    const elsewhere = flattenOfficialLocations().filter(
      (row) => row.type === 'village' && !row.code.startsWith('01'),
    );
    expect(elsewhere).toEqual([]);
  });
});

describe('matchOfficial', () => {
  it('matches a village the register wrote without its class word', () => {
    const match = matchOfficial('ໂພນເຄັງ', 'village', villagesOf('0103'));
    expect(match?.official.nameLo).toBe('ບ້ານໂພນເຄັງ');
    expect(match?.quality).toBe('exact');
  });

  it('matches across both spellings of ຳ', () => {
    // `ດ່ານຄໍາ` decomposed in the register, `ບ້ານດ່ານຄຳ` composed on the official list.
    const match = matchOfficial('ດ່ານຄໍາ', 'village', villagesOf('0102'));
    expect(match?.official.nameLo).toBe('ບ້ານດ່ານຄຳ');
  });

  it('reads the capital’s short name as the capital', () => {
    const match = matchOfficial('ນະຄອນຫຼວງ', 'province', provinces());
    expect(match?.official.code).toBe('01');
  });

  it('does not read ວຽງຈັນ as the capital — it is the province around it', () => {
    const match = matchOfficial('ວຽງຈັນ', 'province', provinces());
    expect(match?.official.code).toBe('10');
  });

  it('corrects a district misspelling within two edits', () => {
    expect(matchOfficial('ໄຊເຊດຖາ', 'district', districts())?.official.nameLo).toBe('ໄຊເສດຖາ');
    expect(matchOfficial('ຫາດຊາຍຟອໃ', 'district', districts())?.official.nameLo).toBe('ຫາດຊາຍຟອງ');
    expect(matchOfficial('ຫາດຊອງຟອງ', 'district', districts())?.official.nameLo).toBe('ຫາດຊາຍຟອງ');
  });

  it('holds villages to a single edit, so neighbours do not merge', () => {
    const chanthabouly = villagesOf('0101');
    // Both are real villages of the district, two edits apart.
    expect(matchOfficial('ໜອງທາເໜືອ', 'village', chanthabouly)?.official.nameLo).toBe(
      'ບ້ານໜອງທາເໜືອ',
    );
    expect(matchOfficial('ໜອງທາໃຕ້', 'village', chanthabouly)?.official.nameLo).toBe(
      'ບ້ານໜອງທາໃຕ້',
    );
  });

  it('refuses to choose when two official villages are equally close', () => {
    // `ສີໄຄ` sits one edit from both `ບ້ານສີໄຄທ່າ` and `ບ້ານສີໄຄທົ່ງ` at best — the
    // office decides which, not this function.
    expect(matchOfficial('ສີໄຄ', 'village', villagesOf('0102'))).toBeNull();
  });

  it('reports the arbitrary choice when the official list itself repeats a name', () => {
    // Chanthabouly lists `ບ້ານດົງປາແຫຼບ` twice, as 0101002 and 0101009.
    const match = matchOfficial('ບ້ານດົງປາແຫຼບ', 'village', villagesOf('0101'));
    expect(match?.official.code).toBe('0101002');
    expect(match?.ambiguous).toBe(true);
  });

  it('prefers a code over a name, so a re-run stays put', () => {
    const match = matchOfficial('anything at all', 'village', villagesOf('0101'), {
      code: '0101001',
    });
    expect(match?.quality).toBe('code');
    expect(match?.official.nameLo).toBe('ບ້ານໜອງປີງ');
  });

  it('finds nothing in an empty district rather than reaching into another', () => {
    expect(matchOfficial('ບ້ານໃດກໍໄດ້', 'village', villagesOf('0201'))).toBeNull();
  });
});

describe('looseKey', () => {
  it('folds away the class word, tone marks and the ຼ ligature', () => {
    expect(looseKey('ບ້ານດົງປ່າແລບ', 'village')).toBe(looseKey('ດົງປາແລບ', 'village'));
    expect(looseKey('ບ້ານຂົວຫຼວງ', 'village')).toBe(looseKey('ຂົວຫລວງ', 'village'));
  });

  it('keeps two different places apart', () => {
    expect(looseKey('ບ້ານໜອງທາເໜືອ', 'village')).not.toBe(looseKey('ບ້ານໜອງທາໃຕ້', 'village'));
  });
});
