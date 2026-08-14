import {
  guardianKey,
  locationLookupName,
  parseGender,
  parseSourceDate,
  splitContact,
  splitEnglishName,
  splitLaoName,
  splitTitle,
} from './student-import.mapper';

/**
 * Every case here is taken from the school's own register, because the mapper's
 * only job is to survive how that file is actually written.
 */
describe('student import mapper', () => {
  describe('splitTitle', () => {
    it('lifts the honorific out of the given name', () => {
      expect(splitTitle('ນ. ຈຸທາລັດ')).toEqual({ title: 'ນ.', name: 'ຈຸທາລັດ' });
      expect(splitTitle('ທ້າວ ສົມສັກ')).toEqual({ title: 'ທ້າວ', name: 'ສົມສັກ' });
    });

    it('leaves a name that merely has two words intact', () => {
      expect(splitTitle('ຈຸທາລັດ ໄຊຍະ')).toEqual({ name: 'ຈຸທາລັດ ໄຊຍະ' });
      expect(splitTitle('ຈຸທາລັດ')).toEqual({ name: 'ຈຸທາລັດ' });
    });
  });

  describe('splitLaoName', () => {
    it('takes the last token as the family name', () => {
      expect(splitLaoName('ເພັດສະໝອນ ວົງວຽງຄໍາ')).toEqual({
        firstNameLo: 'ເພັດສະໝອນ',
        lastNameLo: 'ວົງວຽງຄໍາ',
      });
    });

    it('keeps a multi-word given name whole', () => {
      expect(splitLaoName('ຄໍາ ສາຄອນ ສີຫາປັນຍາ')).toEqual({
        firstNameLo: 'ຄໍາ ສາຄອນ',
        lastNameLo: 'ສີຫາປັນຍາ',
      });
    });

    it("falls back to the child's family name when a parent has only one", () => {
      expect(splitLaoName('ແກ້ວ', 'ອິນທະວົງ')).toEqual({
        firstNameLo: 'ແກ້ວ',
        lastNameLo: 'ອິນທະວົງ',
      });
      // Nothing to fall back to: better a repeat than an empty required field.
      expect(splitLaoName('ແກ້ວ')).toEqual({ firstNameLo: 'ແກ້ວ', lastNameLo: 'ແກ້ວ' });
    });
  });

  describe('splitEnglishName', () => {
    it('reads the shouted surname the register uses', () => {
      expect(splitEnglishName('Chouthalath SIHAPANYA')).toEqual({
        firstNameEn: 'Chouthalath',
        lastNameEn: 'SIHAPANYA',
      });
    });

    it('keeps a two-word given name out of the surname', () => {
      expect(splitEnglishName('Siri Mala INTHAVONG')).toEqual({
        firstNameEn: 'Siri Mala',
        lastNameEn: 'INTHAVONG',
      });
    });

    it('falls back to the last token when nothing is capitalized', () => {
      expect(splitEnglishName('Siri Inthavong')).toEqual({
        firstNameEn: 'Siri',
        lastNameEn: 'Inthavong',
      });
      expect(splitEnglishName('Siri')).toEqual({ firstNameEn: 'Siri' });
      expect(splitEnglishName('')).toEqual({});
    });
  });

  describe('parseGender', () => {
    it('maps the Lao words the register uses', () => {
      expect(parseGender('ຍິງ')).toBe('female');
      expect(parseGender('ຊາຍ')).toBe('male');
      expect(parseGender('anything else')).toBe('other');
    });
  });

  describe('parseSourceDate', () => {
    it('reads the day-first dotted form', () => {
      expect(parseSourceDate('18.5.2014')?.toISOString()).toBe('2014-05-18T00:00:00.000Z');
      expect(parseSourceDate('23.1.2014')?.toISOString()).toBe('2014-01-23T00:00:00.000Z');
    });

    it('also reads ISO, and rejects a date that does not exist', () => {
      expect(parseSourceDate('2014-05-18')?.toISOString()).toBe('2014-05-18T00:00:00.000Z');
      // Would silently roll into March if handed to the Date constructor.
      expect(parseSourceDate('31.2.2014')).toBeNull();
      expect(parseSourceDate('not a date')).toBeNull();
      expect(parseSourceDate('')).toBeNull();
    });
  });

  describe('splitContact', () => {
    it('normalizes a plain number the way the register writes it', () => {
      expect(splitContact('5885 1773')).toEqual({ contactPhone: '02058851773' });
    });

    it('takes the annotation out so the number still normalizes', () => {
      expect(splitContact('9112 1155 (ເອື້ອຍລ້ຽງ)')).toEqual({
        contactPhone: '02091121155',
        contactName: 'ເອື້ອຍລ້ຽງ',
      });
    });

    it('finds the number when the note is written first instead', () => {
      // The same fact, the other way round on a later sheet.
      expect(splitContact('ເອື້ອຍລ້ຽງ(ໜູເລັກ) 9112 1155')).toEqual({
        contactPhone: '02091121155',
        contactName: 'ເອື້ອຍລ້ຽງ ໜູເລັກ',
      });
    });

    it('refuses digits that do not make a Lao number', () => {
      // Better no number than prose filed under a field the school later dials.
      expect(splitContact('ຕິດຕໍ່ບໍ່ໄດ້ 12')).toEqual({ contactName: 'ຕິດຕໍ່ບໍ່ໄດ້' });
    });

    it('yields nothing for an empty cell', () => {
      expect(splitContact('')).toEqual({});
      expect(splitContact(null)).toEqual({});
    });
  });

  describe('parseSourceDate', () => {
    it('reads the day-first dates the register writes', () => {
      expect(parseSourceDate('18.5.2014')?.toISOString()).toBe('2014-05-18T00:00:00.000Z');
      expect(parseSourceDate('1/6/2012')?.toISOString()).toBe('2012-06-01T00:00:00.000Z');
    });

    it('survives a space typed inside the date', () => {
      // `01. 01.2010` off a real roll sheet — spacing, not meaning.
      expect(parseSourceDate('01. 01.2010')?.toISOString()).toBe('2010-01-01T00:00:00.000Z');
    });

    it('refuses a month that does not exist rather than guessing', () => {
      // `29/22/2008` could be a transposed 29/2 or a mistyped 29/12; only the
      // school knows which, so the row is reported instead of invented.
      expect(parseSourceDate('29/22/2008')).toBeNull();
    });
  });

  describe('guardianKey', () => {
    it('matches the same parent across the two rows of their children', () => {
      // Written with a space on one row and in full on another.
      expect(guardianKey('ຄໍາສາຄອນ ສີຫາປັນຍາ', '5885 1773')).toBe(
        guardianKey('ຄໍາສາຄອນ  ສີຫາປັນຍາ', '02058851773'),
      );
    });

    it('keeps two parents sharing one handset apart', () => {
      expect(guardianKey('ໜູເພັດ ອິນທະວົງ', '5555 1855')).not.toBe(
        guardianKey('ແກ້ວ ອິນທະວົງ', '5555 1855'),
      );
    });
  });

  describe('locationLookupName', () => {
    it('folds the class word the register drops', () => {
      expect(locationLookupName('ບ້ານໂພນເຄັງ', 'village')).toBe(
        locationLookupName('ໂພນເຄັງ', 'village'),
      );
      expect(locationLookupName('ເມືອງໄຊເຊດຖາ', 'district')).toBe(
        locationLookupName('ໄຊເຊດຖາ', 'district'),
      );
    });

    it('does not merge the capital with the province around it', () => {
      expect(locationLookupName('ນະຄອນຫຼວງວຽງຈັນ', 'province')).not.toBe(
        locationLookupName('ວຽງຈັນ', 'province'),
      );
    });
  });
});
