import { ageOn, summarizeStudents } from './student-stats';
import { birthDateRangeForAge } from './students.service';

const today = new Date('2026-10-12T09:30:00.000Z');
const dob = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('summarizeStudents', () => {
  const stats = summarizeStudents(
    [
      { gender: 'female', dateOfBirth: dob('2015-10-13') }, // 10 — turns 11 tomorrow
      { gender: 'male', dateOfBirth: dob('2015-10-12') }, // 11 today
      { gender: 'female', dateOfBirth: dob('2010-04-12') }, // 16
      { gender: 'male', dateOfBirth: dob('2010-01-01') }, // 16
      { gender: 'male', dateOfBirth: dob('2004-01-01') }, // 22
      { gender: 'female', dateOfBirth: null },
    ],
    today,
  );
  const age = (n: number) => stats.ages.find((row) => row.age === n);

  it('counts everyone, by gender', () => {
    expect(stats).toMatchObject({ total: 6, female: 3, male: 3 });
  });

  it('puts each child in one age bucket, the buckets adding up to the total', () => {
    expect(stats.under).toEqual({ total: 1, female: 1, male: 0 });
    expect(age(11)).toEqual({ age: 11, total: 1, female: 0, male: 1 });
    expect(age(16)).toEqual({ age: 16, total: 2, female: 1, male: 1 });
    expect(stats.over).toEqual({ total: 1, female: 0, male: 1 });
    expect(stats.unknown).toEqual({ total: 1, female: 1, male: 0 });

    const bucketed =
      stats.under.total +
      stats.over.total +
      stats.unknown.total +
      stats.ages.reduce((sum, row) => sum + row.total, 0);
    expect(bucketed).toBe(stats.total);
  });

  it('lists every age from 11 to 20, empty ones included', () => {
    expect(stats.ages.map((row) => row.age)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(age(13)?.total).toBe(0);
  });
});

describe('ageOn', () => {
  it('agrees with the filter a click on the bucket sends', () => {
    // A child counted at an age must be returned when the list is filtered by it.
    for (const iso of ['2014-10-12', '2013-10-13', '2010-04-12', '2008-02-29']) {
      const age = ageOn(dob(iso), today);
      const range = birthDateRangeForAge(age, today);
      expect(dob(iso) > range.$gt && dob(iso) <= range.$lte).toBe(true);
    }
  });
});
