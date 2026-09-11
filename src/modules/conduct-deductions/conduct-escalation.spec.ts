import { conductGradeFor } from '../term-results/grading';
import { sortOrderFromCode } from './conduct-rules.service';
import {
  CONDUCT_BASE_SCORE,
  escalationFor,
  ladderAscending,
  remainingFrom,
} from './conduct-escalation';

/**
 * The ladder is the half of the rule sheet that decides what actually happens to
 * a child, so it is asserted at its edges rather than in the middle of each
 * band: every rung is reached at the number the sheet prints, and one point
 * short of it is still the rung below.
 */
describe('escalationFor', () => {
  const levelAt = (deducted: number) => escalationFor(deducted).level;

  it('leaves a clean record alone', () => {
    expect(levelAt(0)).toBe('none');
    // Two 5-point rules is still short of the first rung.
    expect(levelAt(5)).toBe('none');
    expect(levelAt(9)).toBe('none');
  });

  it('reaches each rung at the number the sheet prints', () => {
    expect(levelAt(10)).toBe('classroom');
    expect(levelAt(20)).toBe('level1');
    expect(levelAt(30)).toBe('level2');
    expect(levelAt(70)).toBe('level3');
    expect(levelAt(100)).toBe('review');
  });

  it('holds a rung until the next one is reached', () => {
    // The sheet writes 10–15 and 30–50, but a child on 60 has plainly passed the
    // second of those and not reached ຂັ້ນ 3.
    expect(levelAt(15)).toBe('classroom');
    expect(levelAt(19)).toBe('classroom');
    expect(levelAt(29)).toBe('level1');
    expect(levelAt(50)).toBe('level2');
    expect(levelAt(60)).toBe('level2');
    expect(levelAt(99)).toBe('level3');
  });

  it('does not fall off the top when a year is over-deducted', () => {
    // Nobody stops at exactly 100: the last rule applied can take it past.
    expect(levelAt(115)).toBe('review');
  });

  /**
   * Each rung names who convenes over it, copied from the sheet rather than
   * derived — which is why the audience is not simply the rung below plus one.
   * ຂັ້ນ 3 hands the case to the school and stops naming the homeroom teacher and
   * the discipline committee; that is what the paper says, so that is what this
   * asserts.
   */
  it('names the audience each rung is convened for', () => {
    expect(escalationFor(0).notify).toEqual([]);
    // Handled in the room: the homeroom teacher and the child, and nobody else.
    expect(escalationFor(10).notify).toEqual(['homeroomTeacher', 'student']);
    expect(escalationFor(20).notify).toEqual([
      'homeroomTeacher',
      'disciplineCommittee',
      'guardian',
      'student',
    ]);
    expect(escalationFor(30).notify).toEqual([
      'homeroomTeacher',
      'studentAffairs',
      'disciplineCommittee',
      'guardian',
      'student',
    ]);
    expect(escalationFor(70).notify).toEqual(['director', 'studentAffairs', 'guardian', 'student']);
  });

  it('tells the guardians from ຂັ້ນ 1 upwards, and the director from ຂັ້ນ 3', () => {
    expect(escalationFor(19).notify).not.toContain('guardian');
    expect(escalationFor(20).notify).toContain('guardian');
    expect(escalationFor(69).notify).not.toContain('director');
    expect(escalationFor(70).notify).toContain('director');
  });

  it('renders the ladder least severe first, for a screen that shows it', () => {
    expect(ladderAscending().map((rung) => rung.level)).toEqual([
      'none',
      'classroom',
      'level1',
      'level2',
      'level3',
      'review',
    ]);
  });
});

describe('remainingFrom', () => {
  it('counts down from the 100 every child starts the school year on', () => {
    expect(remainingFrom(0)).toBe(CONDUCT_BASE_SCORE);
    expect(remainingFrom(35)).toBe(65);
  });

  it('floors at zero rather than printing a negative score', () => {
    expect(remainingFrom(120)).toBe(0);
  });

  /**
   * The remaining score is what the report card prints, so it has to land in a
   * band the existing conduct scale actually has.
   */
  it('lands on the conduct bands the report card grades by', () => {
    expect(conductGradeFor(remainingFrom(5))).toBe('excellent');
    expect(conductGradeFor(remainingFrom(20))).toBe('very_good');
    expect(conductGradeFor(remainingFrom(30))).toBe('good');
    expect(conductGradeFor(remainingFrom(70))).toBe('poor');
    expect(conductGradeFor(remainingFrom(100))).toBe('poor');
  });
});

/**
 * A rule added by the office has to land where its number says, not at the top
 * of the column: the screen is a copy of the sheet on the wall, and one that
 * reordered itself as it was filled in would stop being one.
 */
describe('sortOrderFromCode', () => {
  it('counts with the trailing digits of the number', () => {
    expect(sortOrderFromCode('2.1')).toBe(1);
    expect(sortOrderFromCode('2.3')).toBe(3);
    // Not 1: the tenth item, and it belongs after the ninth.
    expect(sortOrderFromCode('2.10')).toBe(10);
  });

  it('falls back to the front for a number it cannot read', () => {
    expect(sortOrderFromCode('ອື່ນໆ')).toBe(0);
    expect(sortOrderFromCode('')).toBe(0);
  });
});
