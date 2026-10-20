import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';

/**
 * Puts ພາສາລາວ, ປະຫວັດສາດ, ສຶກສາພົນລະເມືອງ and ພູມສາດ on a month out of 9, and
 * cuts the ກວດກາ marks already written down to the new maximum.
 *
 *   npm run migrate:nine-point-subjects -- --dry-run
 *   npm run migrate:nine-point-subjects
 *
 * **Run `migrate:split-lower-subjects` first.** The ມ.1–ມ.3 social subjects are
 * created by that script; this one refuses to start while any of them is missing,
 * because running the two the other way round would leave those three on 10.
 *
 * The office's ruling of 20 Oct 2026 — these four subjects never reach 10:
 *
 *   ພາສາລາວ, every grade                                 1 / 1 / 2 / 5
 *   ປະຫວັດສາດ · ສຶກສາພົນລະເມືອງ · ພູມສາດ, ມ.1–ມ.3, ມ.5, ມ.6  1 / 0 / 3 / 5   (no ປື້ມ)
 *   the same three at ມ.4, ມ.7                           1 / 1 / 2 / 5
 *
 * Only ກວດກາ shrinks (6 → 5), so no other column has marks to move. The marks
 * already written above 5 are **cut to 5** (the office's choice, over scaling by
 * 5/6): a 5.5 becomes 5, a 4.8 stays 4.8. Their ສອບເສັງ is out of 9 as well, so
 * an exam mark above 9 is cut to 9 the same way. Submitted months are cut too and
 * counted in the log.
 *
 * Every stored term result is then flagged stale — ພາສາລາວ is in every class —
 * so publication waits until each class is recomputed on the new full mark.
 *
 * Idempotent: a subject already on its scheme is not rewritten and a mark at or
 * under the maximum is not touched. A scheme the office set in the admin is
 * overwritten — this is the office's own instruction — and the old one is logged.
 */

const FULL_COLUMNS = { attendance: 1, notebook: 1, activity: 2, test: 5 };
const NO_NOTEBOOK = { attendance: 1, notebook: 0, activity: 3, test: 5 };
type Columns = typeof FULL_COLUMNS;

const TEST_MAX = 5;
const FULL_MARK = 9;

const GRADES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const;
const SOCIAL = ['CIV', 'GEO', 'HIST'] as const;
/** The grades where the social subjects keep a ປື້ມ mark. */
const SOCIAL_WITH_NOTEBOOK = new Set<string>(['M4', 'M7']);
/** Made by `migrate:split-lower-subjects`; their absence means it has not run. */
const SPLIT_FIRST = ['M1', 'M2', 'M3'].flatMap((grade) => SOCIAL.map((code) => `${code}-${grade}`));

const TARGETS: { code: string; columns: Columns }[] = [
  ...GRADES.map((grade) => ({ code: `LAO-${grade}`, columns: FULL_COLUMNS })),
  ...GRADES.flatMap((grade) =>
    SOCIAL.map((code) => ({
      code: `${code}-${grade}`,
      columns: SOCIAL_WITH_NOTEBOOK.has(grade) ? FULL_COLUMNS : NO_NOTEBOOK,
    })),
  ),
];

interface SubjectRow {
  _id: Types.ObjectId;
  code: string;
  nameLo: string;
  monthlyColumnMax?: Columns | null;
}

async function main(): Promise<void> {
  const logger = new Logger('NinePointSubjects');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const subjects = db.collection<SubjectRow>('subjects');
  const monthlyMarks = db.collection('monthlyMarks');
  const termMarks = db.collection('subjectTermMarks');
  const termResults = db.collection('termResults');

  const notSplit: string[] = [];
  for (const code of SPLIT_FIRST) {
    if (!(await subjects.findOne({ code, deletedAt: null }))) notSplit.push(code);
  }
  if (notSplit.length > 0) {
    throw new Error(
      `${notSplit.join(', ')} not in the register — run migrate:split-lower-subjects first`,
    );
  }

  const totals = { moved: 0, already: 0, tests: 0, testsLocked: 0, exams: 0, stale: 0 };
  const missing: string[] = [];

  for (const target of TARGETS) {
    const subject = await subjects.findOne({ code: target.code, deletedAt: null });
    if (!subject) {
      missing.push(target.code);
      continue;
    }

    if (sameScheme(subject.monthlyColumnMax, target.columns)) {
      totals.already += 1;
    } else {
      logger.log(
        `${subject.code} (${subject.nameLo}) ${describe(subject.monthlyColumnMax)} → ` +
          describe(target.columns),
      );
      if (!dryRun) {
        await subjects.updateOne(
          { _id: subject._id },
          { $set: { monthlyColumnMax: { ...target.columns }, updatedAt: new Date() } },
        );
      }
      totals.moved += 1;
    }

    const overTest = { subjectId: subject._id, deletedAt: null, test: { $gt: TEST_MAX } };
    const tests = await monthlyMarks.countDocuments(overTest);
    const testsLocked = await monthlyMarks.countDocuments({ ...overTest, isLocked: true });
    const overExam = { subjectId: subject._id, deletedAt: null, examScore: { $gt: FULL_MARK } };
    const exams = await termMarks.countDocuments(overExam);

    if (!dryRun) {
      if (tests > 0) {
        await monthlyMarks.updateMany(overTest, {
          $set: { test: TEST_MAX, updatedAt: new Date() },
        });
      }
      if (exams > 0) {
        await termMarks.updateMany(overExam, {
          $set: { examScore: FULL_MARK, updatedAt: new Date() },
        });
      }
    }
    if (tests > 0 || exams > 0) {
      logger.log(
        `  ${subject.code}: ${tests} ກວດກາ mark(s) above ${TEST_MAX} cut to ${TEST_MAX} ` +
          `(${testsLocked} in a submitted month), ${exams} ສອບເສັງ above ${FULL_MARK} cut`,
      );
    }
    totals.tests += tests;
    totals.testsLocked += testsLocked;
    totals.exams += exams;
  }

  if (missing.length > 0) {
    logger.warn(`not in the register, nothing changed for: ${missing.join(', ')}`);
  }

  // ພາສາລາວ is in every class, so every stored term result now reads a full mark
  // it was not computed on.
  const staleFilter = { deletedAt: null, isStale: { $ne: true } };
  totals.stale = dryRun
    ? await termResults.countDocuments(staleFilter)
    : (
        await termResults.updateMany(staleFilter, {
          $set: { isStale: true, staleSince: new Date() },
        })
      ).modifiedCount;

  const prefix = dryRun ? '[dry run] ' : '';
  logger.log(
    `${prefix}${totals.moved} subject(s) put on 9, ${totals.already} already there · ` +
      `${totals.tests} ກວດກາ mark(s) cut to ${TEST_MAX} (${totals.testsLocked} submitted) · ` +
      `${totals.exams} ສອບເສັງ cut to ${FULL_MARK} · ` +
      `${totals.stale} term result(s) flagged stale — recompute every class`,
  );

  await connection.close();
}

const describe = (columns: Columns | null | undefined): string =>
  columns
    ? `${columns.attendance} / ${columns.notebook} / ${columns.activity} / ${columns.test}`
    : 'the standard 1 / 1 / 2 / 6';

const sameScheme = (a: Columns | null | undefined, b: Columns): boolean =>
  !!a &&
  a.attendance === b.attendance &&
  a.notebook === b.notebook &&
  a.activity === b.activity &&
  a.test === b.test;

main().catch((error: unknown) => {
  new Logger('NinePointSubjects').error(error);
  process.exit(1);
});
