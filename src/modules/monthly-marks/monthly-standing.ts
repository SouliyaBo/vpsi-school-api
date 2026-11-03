import { round2 } from '../term-results/grading';
import { passingMarkFor } from './monthly-grading';

/**
 * ສະຫຼຸບຜົນການຮຽນປະຈຳເດືອນ — where each student stands at the end of a month.
 *
 * The office asked four questions of a month's marks: who has 7 or more in every
 * subject, who has dropped below 5 in any, how those shares moved since the
 * month before, and which subjects the drops are in. This file holds the rules
 * that answer them; the service does the reads.
 *
 * Settled with the office on 29 Oct 2026:
 *
 *  - **7 is 7 on every subject**, the 9-point ones included: a 6.8 out of 9 is
 *    not 7 or more, however close its share of 9 is. The office chose this over
 *    the proportional 6.3 knowing it is harder to reach.
 *  - **Below 5 is the subject's own pass line**: 5 of 10, 4.5 of 9 — the same
 *    line the mark sheet colours red, through `passingMarkFor`.
 *  - **Judged on the mark as written**, never on the one-decimal display: 4.96
 *    is below 5 and 6.96 is below 7.
 *  - **A month with an unmarked subject is not finished**, so it is kept out of
 *    the shares — except that a mark already below the line is a fact whatever
 *    the other subjects turn out to be, so that student counts as ຫຼຸດ at once.
 */

/** 7 or more in a subject, on every subject's own marks. */
export const TOP_MARK = 7;

/**
 * - `top` — 7 or more in every subject (ດີ)
 * - `middle` — nothing below the pass line, something below 7 (ກາງ)
 * - `below` — below the pass line in at least one subject (ຫຼຸດ)
 * - `incomplete` — a subject still unmarked and nothing failed yet (ຍັງບໍ່ຄົບ)
 */
export const STANDING_BANDS = ['top', 'middle', 'below', 'incomplete'] as const;
export type StandingBand = (typeof STANDING_BANDS)[number];

/** Below the subject's pass line: 5 of 10, 4.5 of 9. */
export function failsSubject(score: number, fullMark: number): boolean {
  return score < passingMarkFor(fullMark);
}

/** 7 or more, whatever the subject is out of. */
export function reachesTop(score: number): boolean {
  return score >= TOP_MARK;
}

/**
 * A student's band for the month, from one mark per subject the grade sits.
 *
 * `scores` and `fullMarks` run in the same subject order; `null` is a subject
 * not yet marked.
 */
export function standingOf(scores: (number | null)[], fullMarks: number[]): StandingBand {
  const fails = scores.some(
    (score, index) => score !== null && failsSubject(score, fullMarks[index] ?? 10),
  );
  if (fails) return 'below';
  if (scores.length === 0 || scores.some((score) => score === null)) return 'incomplete';
  return scores.every((score) => reachesTop(score as number)) ? 'top' : 'middle';
}

export interface BandTally {
  /** Everyone counted, finished or not. */
  students: number;
  top: number;
  middle: number;
  below: number;
  incomplete: number;
  /** top + middle + below — what the shares are taken over. */
  decided: number;
  /** Percent of `decided`, or `null` when nobody is. */
  topPercent: number | null;
  middlePercent: number | null;
  belowPercent: number | null;
}

export function tallyBands(bands: StandingBand[]): BandTally {
  const count = (band: StandingBand) => bands.filter((entry) => entry === band).length;
  const top = count('top');
  const middle = count('middle');
  const below = count('below');
  const decided = top + middle + below;
  return {
    students: bands.length,
    top,
    middle,
    below,
    incomplete: count('incomplete'),
    decided,
    topPercent: percentOf(top, decided),
    middlePercent: percentOf(middle, decided),
    belowPercent: percentOf(below, decided),
  };
}

export interface SubjectTally {
  /** Students with a mark in the subject this month. */
  marked: number;
  /** Of those, below the pass line. */
  failed: number;
  /** Of those, 7 or more. */
  top: number;
  failedPercent: number | null;
  topPercent: number | null;
}

/** One subject over a set of students — the marks that are in, unmarked ones aside. */
export function tallySubject(scores: (number | null)[], fullMark: number): SubjectTally {
  const marked = scores.filter((score): score is number => score !== null);
  const failed = marked.filter((score) => failsSubject(score, fullMark)).length;
  const top = marked.filter(reachesTop).length;
  return {
    marked: marked.length,
    failed,
    top,
    failedPercent: percentOf(failed, marked.length),
    topPercent: percentOf(top, marked.length),
  };
}

/** Adds subject tallies kept apart — the same subject in several classes. */
export function sumSubjectTallies(tallies: SubjectTally[]): SubjectTally {
  const marked = tallies.reduce((sum, tally) => sum + tally.marked, 0);
  const failed = tallies.reduce((sum, tally) => sum + tally.failed, 0);
  const top = tallies.reduce((sum, tally) => sum + tally.top, 0);
  return {
    marked,
    failed,
    top,
    failedPercent: percentOf(failed, marked),
    topPercent: percentOf(top, marked),
  };
}

/** A share in percent to two places, `null` over nobody rather than 0%. */
export function percentOf(count: number, of: number): number | null {
  return of > 0 ? round2((count / of) * 100) : null;
}
