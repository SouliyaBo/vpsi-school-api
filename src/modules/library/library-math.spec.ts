import {
  cellBelowLoans,
  cellKey,
  copiesAvailable,
  matrixTotals,
  titleValue,
  workbookTotals,
  type MatrixRow,
} from './library-math';

describe('matrixTotals', () => {
  // The office's ຄູ່ມືຄູ sheet, ມ.1 and ມ.7 columns: ພາສາລາວ, ຄະນິດ, ຊີວະ, ອັງກິດ.
  const rows: MatrixRow[] = [
    { name: 'ພາສາລາວ', counts: { m1: 4, m7: 4 } },
    { name: 'ຄະນິດສາດ', counts: { m1: 4, m7: 4 } },
    { name: 'ຊີວະສາດ', counts: { m7: 3 } },
    { name: 'ພາສາອັງກິດ', counts: { m1: 4, m7: 4 } },
  ];

  it('adds rows and columns from the cells, never from a printed total', () => {
    const totals = matrixTotals(rows, ['m1', 'm7']);
    expect(totals.rowTotals).toEqual([8, 8, 3, 8]);
    expect(totals.columnTotals).toEqual({ m1: 12, m7: 15 });
    expect(totals.grandTotal).toBe(27);
  });

  it('agrees down and across', () => {
    const totals = matrixTotals(rows, ['m1', 'm7']);
    const columns = Object.values(totals.columnTotals).reduce((a, b) => a + b, 0);
    expect(columns).toBe(totals.grandTotal);
  });

  it('ignores a count filed against a grade that is not a column', () => {
    const totals = matrixTotals([{ name: 'x', counts: { m1: 2, gone: 9 } }], ['m1']);
    expect(totals.grandTotal).toBe(2);
  });
});

describe('workbookTotals', () => {
  // The 2025–2026 sheet: ມ.5 5×24 at 170,000; ມ.6 5×29 at 200,000; ມ.7 4×17 at 165,000.
  const lines = [
    { booksPerSet: 5, setsProduced: 24, pricePerSet: 170_000 },
    { booksPerSet: 5, setsProduced: 29, pricePerSet: 200_000 },
    { booksPerSet: 4, setsProduced: 17, pricePerSet: 165_000 },
  ];

  it('reproduces the office’s figures', () => {
    const totals = workbookTotals(lines);
    expect(totals.lineBooks).toEqual([120, 145, 68]);
    expect(totals.lineAmounts).toEqual([4_080_000, 5_800_000, 2_805_000]);
    expect(totals).toMatchObject({ sets: 70, books: 333, amount: 12_685_000 });
  });

  it('keeps extra sales apart from the sets, and adds them into the grand total', () => {
    // Two ມ.5 sets (10 books) and three single books.
    const totals = workbookTotals(lines, [
      { sets: 2, books: 10, amount: 340_000 },
      { books: 3, amount: 10_000 },
    ]);
    expect(totals).toMatchObject({
      amount: 12_685_000,
      extraSets: 2,
      extraBooks: 13,
      extraAmount: 350_000,
      grandAmount: 13_035_000,
    });
  });
});

describe('titleValue and copiesAvailable', () => {
  it('values a title only when its price is known', () => {
    expect(titleValue(26, 50_000)).toBe(1_300_000);
    expect(titleValue(3, null)).toBeNull();
  });

  it('never reports a negative shelf', () => {
    expect(copiesAvailable(3, 1)).toBe(2);
    expect(copiesAvailable(1, 2)).toBe(0);
  });
});

describe('cellBelowLoans', () => {
  const out = new Map([[cellKey('r1', 'm5'), 2]]);

  it('lets a sheet through that still holds every book out on loan', () => {
    expect(cellBelowLoans(out, [{ rowId: 'r1', counts: { m5: 2 } }])).toBeNull();
  });

  it('stops a count cut below what is lent', () => {
    expect(cellBelowLoans(out, [{ rowId: 'r1', counts: { m5: 1 } }])).toMatchObject({
      onLoan: 2,
      quantity: 1,
    });
  });

  it('stops a row deleted while its books are out, even if a new row has the same name', () => {
    expect(cellBelowLoans(out, [{ rowId: 'r9', counts: { m5: 9 } }])).not.toBeNull();
  });
});
