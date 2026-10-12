import { birthDateRangeForAge, bornAfterForAgeUnder } from './students.service';

describe('birthDateRangeForAge', () => {
  const today = new Date('2026-10-12T09:30:00.000Z');
  const range = birthDateRangeForAge(12, today);
  const matches = (dob: string) => {
    const date = new Date(`${dob}T00:00:00.000Z`);
    return date > range.$gt && date <= range.$lte;
  };

  it('takes a child whose 12th birthday is today', () => {
    expect(matches('2014-10-12')).toBe(true);
  });

  it('takes a child who turns 13 tomorrow', () => {
    expect(matches('2013-10-13')).toBe(true);
  });

  it('leaves out a child who turned 13 today', () => {
    expect(matches('2013-10-12')).toBe(false);
  });

  it('leaves out a child who turns 12 tomorrow', () => {
    expect(matches('2014-10-13')).toBe(false);
  });
});

describe('bornAfterForAgeUnder', () => {
  const today = new Date('2026-10-12T09:30:00.000Z');
  const under11 = (dob: string) =>
    new Date(`${dob}T00:00:00.000Z`) > bornAfterForAgeUnder(11, today);

  it('takes a child who turns 11 tomorrow', () => {
    expect(under11('2015-10-13')).toBe(true);
  });

  it('leaves out a child who turned 11 today', () => {
    expect(under11('2015-10-12')).toBe(false);
  });
});
