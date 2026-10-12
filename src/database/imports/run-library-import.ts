import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';
import {
  BOOK_FESTIVAL_2025,
  BOOK_FESTIVAL_2026,
  REFERENCE_BOOKS,
  TEACHER_GUIDES,
  TEXTBOOKS,
  WORKBOOKS_2026_2027,
  workbookPricePerSet,
  workbookSubjects,
  type CountRowSeed,
  type TitleSeed,
} from './library-books';

/**
 * Files the office's paper book lists into ຄັງປື້ມ — see `library-books.ts`.
 *
 *   npm run import:library -- --dry-run
 *   npm run import:library
 *   npm run import:library -- --force-sheets   # replace count sheets that already have rows
 *
 * - ຄູ່ມືຄູ / ແບບຮຽນ go on the **active** school year's count sheets. A sheet
 *   that already has rows is left alone unless `--force-sheets`: once the office
 *   has started typing into it, it is theirs.
 * - Donated and reference titles are keyed on category + title + source / ສົກຮຽນ,
 *   so a re-run updates the same rows instead of adding a second copy. Nothing
 *   is deleted.
 * - The 2026–2027 workbook sheet (ການສ້າງປື້ມແບບບົດເຝິກຫັດອອກຂາຍ) goes on the
 *   school year named 2026-2027, under the same rule as the count sheets.
 * - The reference list's ຄູຢືມ column becomes loans, once each. The paper gives
 *   no loan date, so the loan is dated the day of the import and says so.
 *
 * Writes to whatever `MONGODB_URI` points at — on this machine that is live data.
 */
async function main(): Promise<void> {
  const logger = new Logger('LibraryImport');
  const dryRun = process.argv.includes('--dry-run');
  const forceSheets = process.argv.includes('--force-sheets');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');
  const now = new Date();

  // ── Count sheets ──
  const year = await db.collection('schoolYears').findOne({ isActive: true, deletedAt: null });
  if (!year) throw new Error('no active school year');
  const grades = await db
    .collection('gradeLevels')
    .find({ deletedAt: null }, { projection: { code: 1 } })
    .toArray();
  const gradeId = new Map(grades.map((grade) => [String(grade.code), grade._id]));
  logger.log(`count sheets → school year ${year.nameLo} (${year._id})`);

  const toRows = (rows: CountRowSeed[]) =>
    rows.map((row) => ({
      name: row.name,
      counts: Object.entries(row.counts).map(([code, quantity]) => {
        const id = gradeId.get(code);
        if (!id) throw new Error(`grade ${code} not found`);
        return { gradeLevelId: id, quantity };
      }),
    }));

  for (const [category, rows] of [
    ['teacher_guide', TEACHER_GUIDES],
    ['textbook', TEXTBOOKS],
  ] as const) {
    const sheets = db.collection('bookCountSheets');
    const key = { category, schoolYearId: year._id, deletedAt: null };
    const current = await sheets.findOne(key);
    if (current && (current.rows?.length ?? 0) > 0 && !forceSheets) {
      logger.warn(
        `  skip      ${category}: already has ${current.rows.length} rows (--force-sheets)`,
      );
      continue;
    }
    logger.log(`  ${current ? 'replace' : 'insert '}   ${category}: ${rows.length} rows`);
    if (!dryRun) {
      await sheets.updateOne(
        key,
        {
          $set: { rows: toRows(rows), updatedAt: now },
          $setOnInsert: { note: null, updatedById: null, createdAt: now },
        },
        { upsert: true },
      );
    }
  }

  // ── Workbook sales, 2026–2027 ──
  // Matched on the year's own dates, not on whichever year is active: the sheet
  // says 2026–2027, and running this next year must not file it against 2027–2028.
  const workbookYear = await db.collection('schoolYears').findOne({
    startDate: { $lte: new Date('2027-06-01') },
    endDate: { $gte: new Date('2026-09-01') },
    deletedAt: null,
  });
  if (!workbookYear) throw new Error('no school year covers 2026-2027');
  {
    const sales = db.collection('workbookSaleSheets');
    const key = { schoolYearId: workbookYear._id, deletedAt: null };
    const current = await sales.findOne(key);
    if (current && (current.lines?.length ?? 0) > 0 && !forceSheets) {
      logger.warn(
        `  skip      workbooks: ${workbookYear.nameLo} already has ${current.lines.length} grades`,
      );
    } else {
      for (const line of WORKBOOKS_2026_2027) {
        logger.log(
          `  ${current ? 'replace' : 'insert '}   workbooks ${line.grade}: ${line.setsProduced} sets × ` +
            `${line.books.length} books @ ${workbookPricePerSet(line)}`,
        );
      }
      if (!dryRun) {
        await sales.updateOne(
          key,
          {
            $set: {
              lines: WORKBOOKS_2026_2027.map((line) => {
                const id = gradeId.get(line.grade);
                if (!id) throw new Error(`grade ${line.grade} not found`);
                return {
                  gradeLevelId: id,
                  subjects: workbookSubjects(line),
                  booksPerSet: line.books.length,
                  setsProduced: line.setsProduced,
                  pricePerSet: workbookPricePerSet(line),
                };
              }),
              updatedAt: now,
            },
            $setOnInsert: { extraSales: [], note: null, updatedById: null, createdAt: now },
          },
          { upsert: true },
        );
      }
    }
  }

  // ── Titles ──
  const titles = db.collection('bookTitles');
  const loans = db.collection('bookLoans');
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let loansAdded = 0;

  // ຄູຢືມ names a person by first name only; use the teacher record when exactly
  // one teacher answers to it, and the name as written otherwise.
  const teacherByName = async (name: string) => {
    const found = await db
      .collection('teachers')
      .find(
        { firstNameLo: name, deletedAt: null },
        { projection: { firstNameLo: 1, lastNameLo: 1 } },
      )
      .toArray();
    return found.length === 1 ? found[0] : null;
  };

  const file = async (
    category: 'donated' | 'reference',
    rows: TitleSeed[],
    origin: { source: string | null; academicYear: string | null; label: string },
  ) => {
    for (const row of rows) {
      const key = {
        category,
        title: row.title,
        source: origin.source,
        academicYear: origin.academicYear,
        deletedAt: null,
      };
      const fields = {
        quantity: row.quantity,
        unitPrice: row.unitPrice ?? null,
        note: `${origin.label} ລ/ດ ${row.sheetNo}`,
      };
      const current = await titles.findOne(key);
      const same =
        current !== null &&
        current.quantity === fields.quantity &&
        (current.unitPrice ?? null) === fields.unitPrice;
      const state = same ? 'unchanged' : current ? 'update' : 'insert';
      logger.log(`  ${state.padEnd(9)} ${category.padEnd(9)} ${row.quantity}× ${row.title}`);
      if (same) unchanged += 1;
      else if (current) updated += 1;
      else inserted += 1;

      let titleId = current?._id ?? null;
      if (!dryRun && !same) {
        if (current) {
          await titles.updateOne({ _id: current._id }, { $set: { ...fields, updatedAt: now } });
        } else {
          const result = await titles.insertOne({
            ...key,
            ...fields,
            acquiredOn: null,
            createdAt: now,
            updatedAt: now,
          });
          titleId = result.insertedId;
        }
      }

      if (row.borrower) {
        const teacher = await teacherByName(row.borrower.name);
        const borrowerName = teacher
          ? `${teacher.firstNameLo} ${teacher.lastNameLo ?? ''}`.trim()
          : row.borrower.name;
        const already =
          titleId &&
          (await loans.findOne({
            bookTitleId: titleId,
            borrowerName: { $regex: `^${row.borrower.name}` },
            deletedAt: null,
          }));
        if (already) continue;
        logger.log(`            loan      ${row.borrower.quantity}× → ${borrowerName}`);
        loansAdded += 1;
        if (!dryRun && titleId) {
          await loans.insertOne({
            bookTitleId: new Types.ObjectId(String(titleId)),
            borrowerType: teacher ? 'teacher' : 'other',
            teacherId: teacher?._id ?? null,
            studentId: null,
            borrowerName,
            quantity: row.borrower.quantity,
            loanedOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
            dueOn: null,
            returnedOn: null,
            note: 'ນຳເຂົ້າຈາກຖັນ "ຄູຢືມ" ຂອງໃບລາຍການເອກະສານອ້າງອີງ — ໃບເດີມບໍ່ມີວັນທີຢືມ',
            recordedById: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  };

  await file('donated', BOOK_FESTIVAL_2025, {
    source: 'Book Festival 2025',
    academicYear: '2024-2025',
    label: 'Book Festival 2025 (12-16/3/2025)',
  });
  await file('donated', BOOK_FESTIVAL_2026, {
    source: 'Book Festival 2026',
    academicYear: '2025-2026',
    label: 'Book Festival 2026 (10-15/3/2026)',
  });
  for (const [academicYear, rows] of Object.entries(REFERENCE_BOOKS)) {
    await file('reference', rows, {
      source: null,
      academicYear,
      label: 'ລາຍການປື້ມເອກະສານອ້າງອີງ',
    });
  }

  logger.log(
    `${dryRun ? '[dry run] ' : ''}titles: ${inserted} inserted, ${updated} updated, ` +
      `${unchanged} unchanged; loans: ${loansAdded} added`,
  );
  await connection.close();
}

main().catch(async (error: unknown) => {
  new Logger('LibraryImport').error(error instanceof Error ? error.stack : String(error));
  await connection.close().catch(() => undefined);
  process.exit(1);
});
