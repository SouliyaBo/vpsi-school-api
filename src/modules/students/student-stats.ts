import type { Gender } from 'src/common/constants/enums';

/**
 * The headcount above the student list: how many, how many girls and boys, and
 * how many at each age.
 *
 * Ages 11–20 each get their own bucket because that is the span the school
 * actually teaches (ມ.1 to the oldest ມ.7); anyone outside it is counted at the
 * ends rather than dropped, so the buckets always add back up to the total.
 *
 * Pure so the birthday arithmetic is tested without a database — it must agree
 * with `birthDateRangeForAge`, which is what a click on a bucket filters by.
 */

export const STATS_MIN_AGE = 11;
export const STATS_MAX_AGE = 20;

export interface GenderCount {
  total: number;
  female: number;
  male: number;
}

export interface StudentListStats extends GenderCount {
  /** Younger than `STATS_MIN_AGE`. */
  under: GenderCount;
  /** One row per age from `STATS_MIN_AGE` to `STATS_MAX_AGE`, empty ones included. */
  ages: (GenderCount & { age: number })[];
  /** Older than `STATS_MAX_AGE`. */
  over: GenderCount;
  /** No usable date of birth on file. */
  unknown: GenderCount;
}

/** Whole years between a date of birth and `today`, as the admin's `calculateAge` counts them. */
export function ageOn(dateOfBirth: Date, today: Date): number {
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

const empty = (): GenderCount => ({ total: 0, female: 0, male: 0 });

const add = (bucket: GenderCount, gender: Gender | null | undefined) => {
  bucket.total += 1;
  if (gender === 'female') bucket.female += 1;
  else if (gender === 'male') bucket.male += 1;
};

export function summarizeStudents(
  students: { gender?: Gender | null; dateOfBirth?: Date | null }[],
  today: Date = new Date(),
): StudentListStats {
  const all = empty();
  const under = empty();
  const over = empty();
  const unknown = empty();
  const ages = Array.from({ length: STATS_MAX_AGE - STATS_MIN_AGE + 1 }, (_, index) => ({
    age: STATS_MIN_AGE + index,
    ...empty(),
  }));

  for (const student of students) {
    add(all, student.gender);
    const dob = student.dateOfBirth ? new Date(student.dateOfBirth) : null;
    if (!dob || Number.isNaN(dob.getTime()) || dob > today) {
      add(unknown, student.gender);
      continue;
    }
    const age = ageOn(dob, today);
    if (age < STATS_MIN_AGE) add(under, student.gender);
    else if (age > STATS_MAX_AGE) add(over, student.gender);
    else add(ages[age - STATS_MIN_AGE], student.gender);
  }

  return { ...all, under, ages, over, unknown };
}
