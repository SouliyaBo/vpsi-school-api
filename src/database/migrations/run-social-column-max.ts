import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';
import { isColumnMaxUsable } from 'src/modules/monthly-marks/monthly-grading';

/**
 * Puts the ສັງຄົມ subjects onto the columns the school actually marks them on,
 * and folds the ປື້ມ marks already written into ກິດຈະກຳ.
 *
 *   npm run migrate:social-column-max -- --dry-run
 *   npm run migrate:social-column-max
 *
 * These subjects take no ປື້ມ mark: the notebook column is not kept at all and
 * its point goes to ກິດຈະກຳ.
 *
 *   the usual columns   ຂື້ນຫ້ອງ 1 · ປື້ມ 1 · ກິດຈະກຳ 2 · ກວດກາ 6
 *   these subjects      ຂື້ນຫ້ອງ 1 · ປື້ມ 0 · ກິດຈະກຳ 3 · ກວດກາ 6
 *
 * Which subjects those are depends on the grade, because the register is not the
 * same shape all the way up:
 *
 *   ມ.1–ມ.3   ສັງຄົມ is marked as one subject — ພູມສາດ, ສຶກສາພົນລະເມືອງ and
 *             ປະຫວັດສາດ do not exist as rows until ມ.4, so the scheme goes on
 *             the ສາຍວິຊາ itself.
 *   ມ.5, ມ.6  the three split subjects, each on its own.
 *   ມ.4, ມ.7  nothing: the office confirmed the three are marked there like
 *             every other subject, on the standard 1 / 1 / 2 / 6.
 *
 * **The marks already written move with the column.** A ປື້ມ mark is added to
 * that row's ກິດຈະກຳ and the notebook cell is cleared, which is exactly lossless:
 * ກິດຈະກຳ was out of 2 and ປື້ມ out of 1, so their sum is always within the 3 the
 * column is now out of, and the month's ລວມ does not move by a hundredth. The
 * alternative — leaving the marks under a column the form no longer draws — would
 * keep them counting towards ລວມ with nobody able to see or correct them.
 *
 * A row marked for ປື້ມ but not for ກິດຈະກຳ ends up with a ກິດຈະກຳ mark: the
 * blank was already counting as zero in ລວມ, so this keeps the total the teacher
 * saw. Those rows are counted separately in the log, since they are the only ones
 * where a cell goes from unmarked to marked.
 *
 * Idempotent — a subject already on the scheme is skipped, and a row with no ປື້ມ
 * left is not touched. A subject the office has since put on a scheme of its own
 * is left alone and logged, so an edit made in the admin is never undone.
 */

/** ຂື້ນຫ້ອງ 1 · ປື້ມ 0 · ກິດຈະກຳ 3 · ກວດກາ 6 — what these subjects are marked on. */
const SOCIAL_COLUMNS = { attendance: 1, notebook: 0, activity: 3, test: 6 };

/**
 * The subject rows to move, by `code`.
 *
 * Listed rather than derived from a prefix and a grade, because ມ.1–ມ.3 and
 * ມ.5–ມ.6 name different things — see the note above — and a rule that produced
 * `GEO-M1` would silently find nothing at exactly the grades that matter most.
 */
const TARGET_CODES = [
  'S-M1',
  'S-M2',
  'S-M3',
  'CIV-M5',
  'GEO-M5',
  'HIST-M5',
  'CIV-M6',
  'GEO-M6',
  'HIST-M6',
] as const;

interface SubjectRow {
  _id: Types.ObjectId;
  code: string;
  nameLo: string;
  monthlyColumnMax?: typeof SOCIAL_COLUMNS | null;
}

interface MarkRow {
  _id: Types.ObjectId;
  notebook?: number | null;
  activity?: number | null;
  isLocked?: boolean;
}

async function main(): Promise<void> {
  const logger = new Logger('SocialColumnMax');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const subjects = db.collection<SubjectRow>('subjects');
  const marks = db.collection<MarkRow>('monthlyMarks');

  let updated = 0;
  let already = 0;
  let kept = 0;
  let moved = 0;
  let filledBlank = 0;
  let lockedRows = 0;
  const missing: string[] = [];

  for (const code of TARGET_CODES) {
    const subject = await subjects.findOne({ code, deletedAt: null });
    if (!subject) {
      missing.push(code);
      continue;
    }

    const current = subject.monthlyColumnMax ?? null;
    const onScheme = current !== null && sameScheme(current, SOCIAL_COLUMNS);

    // A scheme the office typed in the admin is theirs, not this script's, so it
    // is reported rather than replaced — and its marks are left where they are,
    // since that scheme may well keep a ປື້ມ column. Anything unusable (a set
    // that does not come to 10, which the API ignores anyway) is corrected.
    if (current !== null && !onScheme && isColumnMaxUsable(current)) {
      logger.warn(
        `${subject.code} already carries its own columns (${describe(current)}) — left alone, ` +
          'change it in the admin if that is wrong',
      );
      kept += 1;
      continue;
    }

    if (onScheme) {
      already += 1;
    } else {
      logger.log(`${subject.code} (${subject.nameLo}) → ${describe(SOCIAL_COLUMNS)}`);
      if (!dryRun) {
        await subjects.updateOne(
          { _id: subject._id },
          { $set: { monthlyColumnMax: SOCIAL_COLUMNS, updatedAt: new Date() } },
        );
      }
      updated += 1;
    }

    // Run on every pass, not only when the subject moves: a re-run after a
    // half-finished one has marks to finish folding.
    const stranded = await marks
      .find({ subjectId: subject._id, notebook: { $ne: null }, deletedAt: null })
      .toArray();

    for (const row of stranded) {
      const notebook = row.notebook ?? 0;
      const activity = row.activity ?? null;
      const combined = Math.min(SOCIAL_COLUMNS.activity, (activity ?? 0) + notebook);

      if (activity === null) filledBlank += 1;
      if (row.isLocked) lockedRows += 1;

      if (!dryRun) {
        await marks.updateOne(
          { _id: row._id },
          { $set: { activity: combined, notebook: null, updatedAt: new Date() } },
        );
      }
      moved += 1;
    }

    if (stranded.length > 0) {
      logger.log(`  ${stranded.length} row(s) with a ປື້ມ mark folded into ກິດຈະກຳ`);
    }
  }

  if (missing.length > 0) {
    logger.warn(`not in the register, nothing changed for: ${missing.join(', ')}`);
  }

  const prefix = dryRun ? '[dry run] ' : '';
  logger.log(
    `${prefix}done — ${updated} subject(s) moved onto ${describe(SOCIAL_COLUMNS)}, ` +
      `${already} already there, ${kept} left on the office's own scheme`,
  );
  logger.log(
    `${prefix}${moved} monthly mark row(s) had ປື້ມ folded into ກິດຈະກຳ — ` +
      `${filledBlank} of them had no ກິດຈະກຳ mark before, ${lockedRows} were in a submitted month`,
  );

  await connection.close();
}

const describe = (columns: typeof SOCIAL_COLUMNS): string =>
  `${columns.attendance} / ${columns.notebook} / ${columns.activity} / ${columns.test}`;

const sameScheme = (a: typeof SOCIAL_COLUMNS, b: typeof SOCIAL_COLUMNS): boolean =>
  a.attendance === b.attendance &&
  a.notebook === b.notebook &&
  a.activity === b.activity &&
  a.test === b.test;

main().catch((error: unknown) => {
  new Logger('SocialColumnMax').error(error);
  process.exit(1);
});
