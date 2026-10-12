/**
 * The arithmetic of ຄັງປື້ມ — every total the office used to add up by hand.
 *
 * The paper sheets carried their own totals, and one of them was wrong: the
 * ຄູ່ມືຄູ sheet printed 20 under ມ.1–ມ.4 where its own rows add to 16, and 14
 * under ມ.7 where they add to 25. Nothing here is ever stored as a total; it is
 * worked out from the rows on every read, so the two cannot disagree again.
 *
 * Pure, and free of Mongoose.
 */

// ── ຄູ່ມືຄູ / ແບບຮຽນ — a subject × grade count sheet ─────────────────────────

export interface MatrixRow {
  name: string;
  /** gradeLevelId → books held. A grade absent from the map is "—", not 0. */
  counts: Record<string, number>;
}

export interface MatrixTotals {
  /** One total per row, in row order. */
  rowTotals: number[];
  /** gradeLevelId → the column's total. */
  columnTotals: Record<string, number>;
  grandTotal: number;
}

export function matrixTotals(rows: MatrixRow[], gradeLevelIds: string[]): MatrixTotals {
  const columnTotals: Record<string, number> = Object.fromEntries(
    gradeLevelIds.map((id) => [id, 0]),
  );
  const rowTotals = rows.map((row) => {
    let total = 0;
    for (const id of gradeLevelIds) {
      const count = row.counts[id] ?? 0;
      total += count;
      columnTotals[id] += count;
    }
    return total;
  });
  return {
    rowTotals,
    columnTotals,
    grandTotal: rowTotals.reduce((sum, total) => sum + total, 0),
  };
}

/** One cell of a count sheet — a row's book at one grade — as a map key. */
export function cellKey(rowId: string, gradeLevelId: string): string {
  return `${rowId}:${gradeLevelId}`;
}

/**
 * The first cell a sheet edit would leave holding fewer books than are out on
 * loan from it, or `null` when the edit is safe.
 *
 * A row deleted while its books are out, or a count cut below what is lent,
 * would leave loans pointing at books the sheet no longer says exist.
 */
export function cellBelowLoans(
  outstanding: Map<string, number>,
  rows: { rowId: string; counts: Record<string, number> }[],
): { key: string; onLoan: number; quantity: number } | null {
  const held = new Map<string, number>();
  for (const row of rows) {
    for (const [gradeId, quantity] of Object.entries(row.counts)) {
      held.set(cellKey(row.rowId, gradeId), quantity);
    }
  }
  for (const [key, onLoan] of outstanding) {
    const quantity = held.get(key) ?? 0;
    if (onLoan > 0 && quantity < onLoan) return { key, onLoan, quantity };
  }
  return null;
}

// ── ການສ້າງປື້ມແບບບົດເຝິກຫັດອອກຂາຍ — workbooks made and sold ──────────────────

export interface WorkbookLine {
  /** ຈຳນວນປື້ມຕໍ່ຊຸດ. */
  booksPerSet: number;
  /** ຈຳນວນທີ່ຜະລິດອອກ (ຊຸດ). */
  setsProduced: number;
  /** ລາຄາຕໍ່ຊຸດ (ກີບ). */
  pricePerSet: number;
}

export interface ExtraSale {
  /** Whole sets; absent or 0 for a sale of single books. */
  sets?: number;
  books: number;
  amount: number;
}

export interface WorkbookTotals {
  /** ລວມຈຳນວນປື້ມ per line: books × sets. */
  lineBooks: number[];
  /** ລວມມູນຄ່າຂາຍ per line: sets × price. */
  lineAmounts: number[];
  sets: number;
  books: number;
  amount: number;
  extraSets: number;
  extraBooks: number;
  extraAmount: number;
  /** The sets' value plus every extra sale — what the school fund should have received. */
  grandAmount: number;
}

export function workbookTotals(lines: WorkbookLine[], extras: ExtraSale[] = []): WorkbookTotals {
  const lineBooks = lines.map((line) => line.booksPerSet * line.setsProduced);
  const lineAmounts = lines.map((line) => line.setsProduced * line.pricePerSet);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const amount = sum(lineAmounts);
  const extraAmount = sum(extras.map((extra) => extra.amount));
  return {
    lineBooks,
    lineAmounts,
    sets: sum(lines.map((line) => line.setsProduced)),
    books: sum(lineBooks),
    amount,
    extraSets: sum(extras.map((extra) => extra.sets ?? 0)),
    extraBooks: sum(extras.map((extra) => extra.books)),
    extraAmount,
    grandAmount: amount + extraAmount,
  };
}

// ── Titles: ປື້ມອຸປະຖຳ, ເອກະສານອ້າງອີງ — and who has them ──────────────────────

/** ລວມມູນຄ່າ of a title: copies × price, or nothing when no price is known. */
export function titleValue(quantity: number, unitPrice: number | null | undefined): number | null {
  return typeof unitPrice === 'number' ? quantity * unitPrice : null;
}

/**
 * Copies still on the shelf: held, less those lent out and not yet back.
 *
 * Floored at zero — an over-lent title is a data problem the loan screen
 * refuses, not a negative shelf.
 */
export function copiesAvailable(quantity: number, outstandingLoans: number): number {
  return Math.max(0, quantity - outstandingLoans);
}
