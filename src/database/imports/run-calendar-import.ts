import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';
import { SCHOOL_CALENDAR_2026_2027 } from './school-calendar-2026-2027';

/**
 * Files the school's printed calendar into `calendarEvents`.
 *
 *   npm run import:calendar -- --dry-run
 *   npm run import:calendar
 *
 * Until this runs, the calendar holds three events from the 2025–2026 seed and
 * nothing else, and every count of school days in the system is a count of
 * weekdays — which is why the roll-call coverage report would have named every
 * teacher in the school for the week of ບຸນປີໃໝ່.
 *
 * Idempotent, and keyed on `titleEn` + `startDate` rather than on the row's id:
 * the sheet is the source, so re-running it after the office corrects a date on
 * the paper moves that entry rather than adding a second one. An entry the office
 * has since edited *in the app* is therefore overwritten — the printed sheet wins,
 * which is the point of an importer — so any office edit to these entries has to
 * be made on the paper too. Events the office adds itself are never touched:
 * nothing here deletes.
 *
 * `titleEn` is the key because it is what the sheet prints and what does not get
 * retranslated; two entries share one (`Report Card Distribution`, `Teacher's PD`)
 * and the date separates them.
 */
async function main(): Promise<void> {
  const logger = new Logger('CalendarImport');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  // The year the sheet is for, matched on its own dates rather than on whichever
  // year happens to be active: running this in June must not file next year's
  // calendar against the year that is closing.
  const schoolYear = await db.collection('schoolYears').findOne({
    startDate: { $lte: new Date('2027-06-10') },
    endDate: { $gte: new Date('2026-08-17') },
    deletedAt: null,
  });
  if (!schoolYear) {
    throw new Error('no school year covers 2026-08-17 … 2027-06-10 — create it first');
  }
  logger.log(`school year: ${schoolYear.nameLo} (${schoolYear._id})`);

  const admin = await db
    .collection('users')
    .findOne({ username: 'admin' }, { projection: { _id: 1 } });
  const events = db.collection('calendarEvents');

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const entry of SCHOOL_CALENDAR_2026_2027) {
    const startDate = new Date(entry.startDate);
    const endDate = new Date(entry.endDate);
    const key = { titleEn: entry.titleEn, startDate, deletedAt: null };

    const current = await events.findOne(key);
    const same =
      current !== null &&
      current.titleLo === entry.titleLo &&
      current.type === entry.type &&
      current.dayEffect === entry.dayEffect &&
      Number(current.endDate) === Number(endDate) &&
      Boolean(current.isHalfDay) === Boolean(entry.isHalfDay);

    const span =
      entry.startDate === entry.endDate ? entry.startDate : `${entry.startDate}…${entry.endDate}`;
    const state = same ? 'unchanged' : current ? 'update' : 'insert';
    logger.log(
      `  ${state.padEnd(9)} ${span.padEnd(21)} ${entry.dayEffect.padEnd(10)} ${entry.titleEn}`,
    );

    if (same) {
      unchanged += 1;
      continue;
    }
    if (current) updated += 1;
    else inserted += 1;
    if (dryRun) continue;

    await events.updateOne(
      key,
      {
        $set: {
          titleLo: entry.titleLo,
          titleEn: entry.titleEn,
          type: entry.type,
          dayEffect: entry.dayEffect,
          startDate,
          endDate,
          isAllDay: true,
          isHalfDay: entry.isHalfDay ?? false,
          schoolYearId: schoolYear._id,
          targets: [],
          deletedAt: null,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdBy: admin?._id ?? new Types.ObjectId(),
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  // Rows written before `dayEffect` existed — the three from the 2025–2026 seed —
  // would classify as open days on their own dates. They are back-filled from
  // their type rather than left to the schema's fallback, so the field is present
  // everywhere and a query on it can be trusted.
  const legacy = await events.find({ dayEffect: { $exists: false }, deletedAt: null }).toArray();
  for (const row of legacy) {
    const effect = row.type === 'holiday' ? 'closed' : row.type === 'exam' ? 'no_classes' : 'open';
    logger.log(`  backfill  ${String(row.startDate).slice(0, 10)} → ${effect}  ${row.titleLo}`);
    if (!dryRun) await events.updateOne({ _id: row._id }, { $set: { dayEffect: effect } });
  }

  logger.log(
    `${dryRun ? '[dry run] ' : ''}done — ${inserted} inserted, ${updated} updated, ` +
      `${unchanged} unchanged, ${legacy.length} back-filled`,
  );

  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('CalendarImport').error(error);
  process.exit(1);
});
