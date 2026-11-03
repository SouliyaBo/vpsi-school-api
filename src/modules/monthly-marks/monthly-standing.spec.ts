import {
  failsSubject,
  percentOf,
  reachesTop,
  standingOf,
  sumSubjectTallies,
  tallyBands,
  tallySubject,
} from './monthly-standing';

describe('failsSubject', () => {
  it('fails below 5 of 10 and passes at 5', () => {
    expect(failsSubject(4.99, 10)).toBe(true);
    expect(failsSubject(5, 10)).toBe(false);
  });

  it('fails below 4.5 on a 9-point subject, not below 5', () => {
    expect(failsSubject(4.49, 9)).toBe(true);
    expect(failsSubject(4.5, 9)).toBe(false);
    expect(failsSubject(4.8, 9)).toBe(false);
  });

  it('judges the mark as written, not as the sheet displays it', () => {
    // 4.96 shows as 5.0 to one decimal.
    expect(failsSubject(4.96, 10)).toBe(true);
  });
});

describe('reachesTop', () => {
  it('is 7 or more as written: 6.96 is not 7', () => {
    expect(reachesTop(7)).toBe(true);
    expect(reachesTop(6.96)).toBe(false);
  });
});

describe('standingOf', () => {
  const tens = (count: number) => Array.from({ length: count }, () => 10);

  it('is top with 7 or more in every subject', () => {
    expect(standingOf([7, 8.5, 10], tens(3))).toBe('top');
  });

  it('is middle with nothing failed but something under 7', () => {
    expect(standingOf([7, 6.5, 9], tens(3))).toBe('middle');
  });

  it('is below with any subject under the pass line', () => {
    expect(standingOf([9, 4.9, 9], tens(3))).toBe('below');
  });

  it('holds a 9-point subject to 7 itself, not to its share of 9', () => {
    // 6.8 of 9 is 75.6% — well past 70%, but the office's 7 is 7.
    expect(standingOf([8, 6.8], [10, 9])).toBe('middle');
    expect(standingOf([8, 7], [10, 9])).toBe('top');
  });

  it('passes a 9-point subject at 4.5', () => {
    expect(standingOf([8, 4.6], [10, 9])).toBe('middle');
    expect(standingOf([8, 4.4], [10, 9])).toBe('below');
  });

  it('is incomplete while a subject is unmarked and nothing has failed', () => {
    expect(standingOf([9, null, 9], tens(3))).toBe('incomplete');
  });

  it('is below at once when a mark already failed, unmarked subjects or not', () => {
    expect(standingOf([3, null, null], tens(3))).toBe('below');
  });

  it('is incomplete for a grade with no subjects to mark', () => {
    expect(standingOf([], [])).toBe('incomplete');
  });
});

describe('tallyBands', () => {
  it('takes the shares over the decided students only', () => {
    const tally = tallyBands(['top', 'top', 'middle', 'below', 'incomplete', 'incomplete']);

    expect(tally).toMatchObject({
      students: 6,
      top: 2,
      middle: 1,
      below: 1,
      incomplete: 2,
      decided: 4,
      topPercent: 50,
      middlePercent: 25,
      belowPercent: 25,
    });
  });

  it('has no shares when nobody is decided', () => {
    expect(tallyBands(['incomplete'])).toMatchObject({
      decided: 0,
      topPercent: null,
      belowPercent: null,
    });
  });
});

describe('tallySubject', () => {
  it('counts the marks that are in against the subject’s own pass line', () => {
    expect(tallySubject([4.4, 4.5, 7, null], 9)).toEqual({
      marked: 3,
      failed: 1,
      top: 1,
      failedPercent: 33.33,
      topPercent: 33.33,
    });
  });

  it('sums the same subject across classes from counts, not from percentages', () => {
    const total = sumSubjectTallies([tallySubject([3, 8], 10), tallySubject([8, 8, 8, 8], 10)]);
    // 1 of 6, not the mean of 50% and 0%.
    expect(total).toMatchObject({ marked: 6, failed: 1, failedPercent: 16.67 });
  });
});

describe('percentOf', () => {
  it('is null over nobody rather than 0%', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(1, 3)).toBe(33.33);
  });
});
