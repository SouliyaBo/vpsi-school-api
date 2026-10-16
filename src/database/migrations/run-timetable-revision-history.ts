import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';
import { toUtcMidnight } from 'src/modules/lesson-plans/lesson-plan-weeks';

/**
 * Dates a timetable revision that was made without `scheduleHistory`.
 *
 *   npm run migrate:timetable-revision-history -- --date=2026-10-05 --dry-run
 *   npm run migrate:timetable-revision-history -- --date=2026-10-05
 *
 * The office revised the timetable on 5 Oct 2026 through an API that predated
 * the dated timetable, so `schedule` was replaced in place and no spell was
 * written. The coverage and punctuality reports then read the new weekdays back
 * over every week of the term: a Tuesday the teacher taught and marked stopped
 * being owed, and every Wednesday before the change became a roll call "never
 * filed". Lessons created that day were worse off, owing from the start of term
 * a register nobody could have kept before they existed.
 *
 * For every live lesson in the revision's term that has no history yet:
 *
 * - **edited that day** — the earliest audit row of the day carries the
 *   arrangement being replaced in `oldValue.schedule`; it gets `[term start,
 *   date)` and the current schedule gets `[date, ∞)`, the shape
 *   `TeachingAssignmentsService.replaceSchedule` writes;
 * - **created that day** — an empty spell `[term start, date)`, so nothing is
 *   owed before the lesson existed, then the current schedule.
 *
 * A lesson whose schedule was edited again on a later day is skipped and listed:
 * the current schedule would not be what the revision left, and the spell
 * between the two edits is not on file in a form this can rebuild.
 *
 * Idempotent: a lesson that already has a history is left alone. To undo, set
 * `scheduleHistory: []` on the ids this prints.
 */

interface PeriodRow {
  dayOfWeek: number;
  isRotating?: boolean;
}

interface AssignmentRow {
  _id: Types.ObjectId;
  semesterId: Types.ObjectId;
  schedule: PeriodRow[];
  scheduleHistory?: unknown[];
  isActive: boolean;
  createdAt: Date;
}

interface AuditRow {
  entityId: Types.ObjectId | string;
  userId?: Types.ObjectId | null;
  oldValue?: { schedule?: PeriodRow[] } | null;
  createdAt: Date;
}

/** Midnight in Vientiane (UTC+7) on the given calendar day, as an instant. */
function vientianeMidnight(day: Date): Date {
  return new Date(day.getTime() - 7 * 60 * 60 * 1000);
}

function describe(schedule: PeriodRow[]): string {
  if (schedule.length === 0) return '—';
  return schedule.map((p) => `${p.dayOfWeek}${p.isRotating ? 'r' : ''}`).join(',');
}

async function main(): Promise<void> {
  const logger = new Logger('TimetableRevisionHistory');
  const dryRun = process.argv.includes('--dry-run');
  const dateArg = process.argv.find((arg) => arg.startsWith('--date='))?.slice('--date='.length);
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    throw new Error('pass the revision day as --date=YYYY-MM-DD');
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  // Spells are keyed by calendar day at UTC midnight; audit rows and createdAt
  // are instants, so the day they fall on is read in Vientiane time.
  const revisionDay = toUtcMidnight(dateArg);
  const dayStart = vientianeMidnight(revisionDay);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const note = `back-filled: timetable revision of ${dateArg}`;

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const audits = await db
    .collection<AuditRow>('auditLogs')
    .find({
      entityType: 'teachingAssignments',
      action: 'update',
      'oldValue.schedule': { $exists: true },
      createdAt: { $gte: dayStart },
    })
    .sort({ createdAt: 1 })
    .toArray();

  const firstEdit = new Map<string, AuditRow>();
  const editedLater = new Set<string>();
  for (const audit of audits) {
    const id = String(audit.entityId);
    if (audit.createdAt >= dayEnd) editedLater.add(id);
    else if (!firstEdit.has(id)) firstEdit.set(id, audit);
  }

  const created = await db
    .collection<AssignmentRow>('teachingAssignments')
    .find({ deletedAt: null, createdAt: { $gte: dayStart, $lt: dayEnd } })
    .project<{ _id: Types.ObjectId }>({ _id: 1 })
    .toArray();
  const createdIds = new Set(created.map((row) => row._id.toString()));

  const ids = [...new Set([...firstEdit.keys(), ...createdIds])].map(
    (id) => new Types.ObjectId(id),
  );
  const rows = await db
    .collection<AssignmentRow>('teachingAssignments')
    .find({ _id: { $in: ids }, deletedAt: null })
    .toArray();

  const termStarts = new Map<string, Date>();
  const termStart = async (semesterId: Types.ObjectId) => {
    const key = semesterId.toString();
    const cached = termStarts.get(key);
    if (cached) return cached;
    const term = await db
      .collection<{ startDate: Date }>('semesters')
      .findOne({ _id: semesterId }, { projection: { startDate: 1 } });
    if (!term) throw new Error(`semester ${key} not found`);
    const start = toUtcMidnight(term.startDate);
    termStarts.set(key, start);
    return start;
  };

  const skipped: string[] = [];
  let filled = 0;
  for (const row of rows) {
    const id = row._id.toString();
    if ((row.scheduleHistory ?? []).length > 0) continue;
    if (editedLater.has(id)) {
      skipped.push(`${id} (edited again after ${dateArg})`);
      continue;
    }

    const opened = await termStart(row.semesterId);
    if (opened >= revisionDay) {
      skipped.push(`${id} (term starts on/after ${dateArg})`);
      continue;
    }

    const isNew = createdIds.has(id);
    const edit = firstEdit.get(id);
    const before = isNew ? [] : (edit?.oldValue?.schedule ?? null);
    if (before === null) continue;

    const spells = [
      { schedule: before, from: opened, to: revisionDay, changedBy: null, note },
      {
        schedule: row.schedule,
        from: revisionDay,
        to: null,
        changedBy: edit?.userId ? new Types.ObjectId(String(edit.userId)) : null,
        note,
      },
    ];

    logger.log(
      `${id} ${isNew ? 'new ' : 'moved'} ${row.isActive ? '' : '(inactive) '}` +
        `${describe(before)} → ${describe(row.schedule)}`,
    );
    if (!dryRun) {
      await db
        .collection('teachingAssignments')
        .updateOne(
          { _id: row._id, $or: [{ scheduleHistory: { $size: 0 } }, { scheduleHistory: null }] },
          { $set: { scheduleHistory: spells } },
        );
    }
    filled += 1;
  }

  const prefix = dryRun ? '[dry run] ' : '';
  logger.log(`${prefix}${filled} lesson(s) dated from ${dateArg}`);
  if (skipped.length > 0) logger.warn(`skipped: ${skipped.join('; ')}`);
  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('TimetableRevisionHistory').error(error);
  process.exit(1);
});
