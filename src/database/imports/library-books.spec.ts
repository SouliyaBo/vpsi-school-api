import {
  BOOK_FESTIVAL_2025,
  BOOK_FESTIVAL_2026,
  REFERENCE_BOOKS,
  TEACHER_GUIDES,
  TEXTBOOKS,
  WORKBOOKS_2026_2027,
  workbookPricePerSet,
  type CountRowSeed,
  type TitleSeed,
} from './library-books';

/**
 * The transcription checked against the totals printed on each sheet — the
 * figures the office signed off, so a misread cell shows up here rather than
 * on the screen.
 */
const sheetTotal = (rows: CountRowSeed[]) =>
  rows.reduce((sum, row) => sum + Object.values(row.counts).reduce((a, b) => a + (b ?? 0), 0), 0);
const copies = (rows: TitleSeed[]) => rows.reduce((sum, row) => sum + row.quantity, 0);
const value = (rows: TitleSeed[]) =>
  rows.reduce((sum, row) => sum + row.quantity * (row.unitPrice ?? 0), 0);

describe('the transcribed book lists', () => {
  it('ຄູ່ມືຄູ adds to the sheet’s 141, with the column totals the rows really give', () => {
    expect(sheetTotal(TEACHER_GUIDES)).toBe(141);
    const column = (grade: keyof CountRowSeed['counts']) =>
      TEACHER_GUIDES.reduce((sum, row) => sum + (row.counts[grade] ?? 0), 0);
    // The sheet printed 20 / 20 / 20 / 20 / 26 / 26 / 14; its own rows give these.
    expect(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map((g) => column(g as never))).toEqual([
      16, 16, 16, 16, 26, 26, 25,
    ]);
  });

  it('ແບບຮຽນ adds to 345, and to the sheet’s column totals', () => {
    expect(sheetTotal(TEXTBOOKS)).toBe(345);
    const column = (grade: keyof CountRowSeed['counts']) =>
      TEXTBOOKS.reduce((sum, row) => sum + (row.counts[grade] ?? 0), 0);
    expect(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map((g) => column(g as never))).toEqual([
      32, 48, 42, 51, 63, 84, 25,
    ]);
  });

  it('Book Festival 2025 is 29 books worth 2,572,000', () => {
    expect(BOOK_FESTIVAL_2025).toHaveLength(22);
    expect(copies(BOOK_FESTIVAL_2025)).toBe(29);
    expect(value(BOOK_FESTIVAL_2025)).toBe(2_572_000);
  });

  it('Book Festival 2026 is 53 books worth 3,504,000', () => {
    expect(BOOK_FESTIVAL_2026).toHaveLength(17);
    expect(copies(BOOK_FESTIVAL_2026)).toBe(53);
    expect(value(BOOK_FESTIVAL_2026)).toBe(3_504_000);
  });

  it('the reference list has 28 titles across two years, item 8 missing as on paper', () => {
    const all = Object.values(REFERENCE_BOOKS).flat();
    expect(all).toHaveLength(28);
    expect(all.map((row) => row.sheetNo)).not.toContain(8);
    expect(copies(REFERENCE_BOOKS['2019-2020'])).toBe(16);
    expect(copies(REFERENCE_BOOKS['2020-2021'])).toBe(22);
  });

  it('the 2026–2027 workbooks are 102 sets, 560 books, at the sheet’s set prices', () => {
    const sets = WORKBOOKS_2026_2027.reduce((sum, line) => sum + line.setsProduced, 0);
    const books = WORKBOOKS_2026_2027.reduce(
      (sum, line) => sum + line.setsProduced * line.books.length,
      0,
    );
    expect(sets).toBe(102);
    expect(books).toBe(560);
    expect(WORKBOOKS_2026_2027.map(workbookPricePerSet)).toEqual([185000, 190000, 200000, 265000]);
    expect(WORKBOOKS_2026_2027.map((line) => line.books.length)).toEqual([5, 5, 5, 7]);
  });
});
