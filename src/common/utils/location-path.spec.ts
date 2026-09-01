import { formatAddressLine, AddressableLocation } from './location-path';

const province: AddressableLocation = { _id: 'p', nameLo: 'ນະຄອນຫຼວງວຽງຈັນ', type: 'province' };
const district: AddressableLocation = {
  _id: 'd',
  nameLo: 'ຈັນທະບູລີ',
  type: 'district',
  ancestors: ['p'],
};
const village: AddressableLocation = {
  // The official list writes the word into the name, which is what makes the
  // prefix logic necessary at all.
  _id: 'v',
  nameLo: 'ບ້ານດອນແດງ',
  type: 'village',
  ancestors: ['p', 'd'],
};

describe('formatAddressLine', () => {
  it('writes village, district then province', () => {
    expect(formatAddressLine(village, [province, district])).toBe(
      'ບ້ານ ດອນແດງ ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ',
    );
  });

  it('orders by level rather than by the order ancestors arrive in', () => {
    expect(formatAddressLine(village, [district, province])).toBe(
      formatAddressLine(village, [province, district]),
    );
  });

  it('does not repeat a prefix the name already carries', () => {
    expect(formatAddressLine(village, [])).toBe('ບ້ານ ດອນແດງ');
    expect(formatAddressLine({ ...village, nameLo: 'ດອນແດງ' }, [])).toBe('ບ້ານ ດອນແດງ');
  });

  it('stops at the district for a birthplace recorded no finer', () => {
    expect(formatAddressLine(district, [province])).toBe('ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ');
  });

  it('writes free-text detail as the village when the tree has no node for it', () => {
    expect(formatAddressLine(district, [province], 'ໜອງບົວທອງ')).toBe(
      'ບ້ານ ໜອງບົວທອງ ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ',
    );
  });

  it('keeps detail next to a village that is on file', () => {
    expect(formatAddressLine(village, [province, district], 'ຫນ່ວຍ 12')).toBe(
      'ບ້ານ ດອນແດງ ຫນ່ວຍ 12 ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ',
    );
  });

  it('is empty when nothing is known, so a caller can print a blank to fill in', () => {
    expect(formatAddressLine(null, [], null)).toBe('');
  });
});
