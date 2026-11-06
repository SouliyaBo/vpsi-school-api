import { monthFigures, sumFigures } from './class-year';

describe('ໝົດປີ ທັງຫ້ອງ — the register columns', () => {
  const month = (absences: [string, number][] | null, deducted: [string, number][] = []) => ({
    absences: absences === null ? null : new Map(absences),
    deducted: new Map(deducted),
  });

  it('prints 0 for a child the roll and the ledger have nothing against', () => {
    expect(monthFigures('b', month([['a', 2]]))).toEqual({ absences: 0, deducted: 0 });
    expect(monthFigures('a', month([['a', 2]], [['a', 5]]))).toEqual({ absences: 2, deducted: 5 });
  });

  it('leaves a month nobody took the roll in blank, not clean', () => {
    expect(monthFigures('a', month(null))).toEqual({ absences: null, deducted: null });
  });

  it('still prints a point taken in a month with no roll', () => {
    expect(monthFigures('a', month(null, [['a', 5]]))).toEqual({ absences: null, deducted: 5 });
  });

  it('adds the terms that have a figure, and leaves the year blank only when none does', () => {
    expect(
      sumFigures([
        { absences: 3, deducted: 10 },
        { absences: null, deducted: null },
      ]),
    ).toEqual({ absences: 3, deducted: 10 });
    expect(sumFigures([{ absences: null, deducted: null }])).toEqual({
      absences: null,
      deducted: null,
    });
  });
});
