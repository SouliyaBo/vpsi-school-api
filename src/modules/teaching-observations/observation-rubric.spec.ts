import {
  computeTotals,
  CRITERION_KEYS,
  CRITERION_MAX_SCORE,
  mergeScores,
  normalizeScores,
  OBSERVATION_CRITERIA,
  OBSERVATION_MAX_TOTAL,
  unscoredCriteria,
} from './observation-rubric';

/** A full sheet, every criterion marked the same. */
const allScored = (score: number) => CRITERION_KEYS.map((criterion) => ({ criterion, score }));

describe('the rubric itself', () => {
  it('is the six criteria the paper form prints, in its order', () => {
    expect(OBSERVATION_CRITERIA).toHaveLength(6);
    expect(OBSERVATION_CRITERIA.map((criterion) => criterion.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is worth ten a row and sixty in total', () => {
    expect(CRITERION_MAX_SCORE).toBe(10);
    expect(OBSERVATION_MAX_TOTAL).toBe(60);
  });

  it('gives every criterion two indicator lines, as the form does', () => {
    for (const criterion of OBSERVATION_CRITERIA) {
      expect(criterion.indicatorsLo).toHaveLength(2);
      expect(criterion.indicatorsEn).toHaveLength(2);
    }
  });

  it('has no duplicate keys — a stored mark must resolve to one row', () => {
    expect(new Set(CRITERION_KEYS).size).toBe(CRITERION_KEYS.length);
  });
});

describe('normalizeScores', () => {
  it('returns all six rows even when the client sent one', () => {
    const rows = normalizeScores([{ criterion: 'materials', score: 7 }]);

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.criterion)).toEqual([...CRITERION_KEYS]);
    expect(rows.find((row) => row.criterion === 'materials')?.score).toBe(7);
  });

  it('leaves an unsent row unmarked rather than zero', () => {
    const rows = normalizeScores([{ criterion: 'materials', score: 7 }]);
    expect(rows.find((row) => row.criterion === 'activities')?.score).toBeNull();
  });

  it('drops a key the rubric does not have', () => {
    const rows = normalizeScores([{ criterion: 'punctuality', score: 9 }]);
    expect(rows.every((row) => row.score === null)).toBe(true);
  });

  it('keeps a deliberate zero, which is a judgement and not a blank', () => {
    const rows = normalizeScores([{ criterion: 'explanation', score: 0 }]);
    expect(rows.find((row) => row.criterion === 'explanation')?.score).toBe(0);
  });
});

describe('mergeScores', () => {
  const stored = allScored(8);

  it('keeps a row the update does not mention', () => {
    const merged = mergeScores(stored, [{ criterion: 'assessment', score: 4 }]);

    expect(merged.find((row) => row.criterion === 'assessment')?.score).toBe(4);
    expect(merged.find((row) => row.criterion === 'materials')?.score).toBe(8);
  });

  it('clears a row sent as null back to unmarked', () => {
    const merged = mergeScores(stored, [{ criterion: 'materials', score: null }]);
    expect(merged.find((row) => row.criterion === 'materials')?.score).toBeNull();
  });

  it('does not confuse clearing a row with marking it zero', () => {
    const cleared = mergeScores(stored, [{ criterion: 'materials', score: null }]);
    const zeroed = mergeScores(stored, [{ criterion: 'materials', score: 0 }]);

    expect(computeTotals(cleared).maxScore).toBe(50);
    expect(computeTotals(zeroed).maxScore).toBe(60);
  });
});

describe('computeTotals', () => {
  it('adds up a full sheet against sixty', () => {
    expect(computeTotals(allScored(9))).toEqual({
      totalScore: 54,
      maxScore: 60,
      scoredCount: 6,
      percentage: 90,
    });
  });

  it('measures a half-filled draft against what has been marked', () => {
    const totals = computeTotals([
      { criterion: 'classroom_control', score: 8 },
      { criterion: 'activities', score: 6 },
    ]);

    expect(totals).toEqual({ totalScore: 14, maxScore: 20, scoredCount: 2, percentage: 70 });
  });

  it('reports no percentage at all for an untouched sheet', () => {
    expect(computeTotals([])).toEqual({
      totalScore: 0,
      maxScore: 0,
      scoredCount: 0,
      percentage: null,
    });
  });

  it('rounds the percentage to one decimal', () => {
    const totals = computeTotals([
      { criterion: 'classroom_control', score: 7 },
      { criterion: 'activities', score: 8 },
      { criterion: 'materials', score: 8 },
    ]);

    expect(totals.percentage).toBe(76.7);
  });

  it('keeps a half mark rather than rounding it into the total', () => {
    const totals = computeTotals([{ criterion: 'materials', score: 7.5 }]);
    expect(totals.totalScore).toBe(7.5);
  });
});

describe('unscoredCriteria', () => {
  it('is empty for a sheet that may be filed', () => {
    expect(unscoredCriteria(allScored(10))).toEqual([]);
  });

  it('names what is still blank, in the form’s order', () => {
    const missing = unscoredCriteria([
      { criterion: 'activities', score: 5 },
      { criterion: 'discipline', score: 5 },
    ]);

    expect(missing).toEqual(['classroom_control', 'materials', 'explanation', 'assessment']);
  });

  it('does not treat a zero as blank', () => {
    expect(unscoredCriteria(allScored(0))).toEqual([]);
  });
});
