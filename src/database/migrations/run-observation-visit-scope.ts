import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';

/**
 * Renumbers ປະເມີນຄັ້ງທີ per observer, and moves the unique index with it.
 *
 *   npm run migrate:observation-visit-scope -- --dry-run
 *   npm run migrate:observation-visit-scope
 *
 * A visit number used to be counted per observed teacher per term, and the
 * unique index said the same. That made the second person to sit in on ຄູແສງ the
 * author of ຄັ້ງທີ 2 — a number that matched nothing on the sheet in their hand,
 * and one they could not file at all if they copied the ຄັ້ງທີ 1 their own paper
 * was headed with. The count is now per observer, per observed teacher, per
 * subject, within the term: each observer's own run of visits. The classroom is
 * not part of it — the same lesson taught to a second room is that run's next
 * visit, not another first one.
 *
 * Two things have to happen together, or the school is left unable to file:
 *
 *  - every unique index on `visitNumber` that is not the current scope is
 *    dropped. Not the original one by name: the scope was narrowed twice while
 *    this was being settled, and a dev server with `autoIndex` on will have left
 *    whichever one it last read from the schema sitting in the collection. Any
 *    of them refuses a ຄັ້ງທີ the application now considers legal;
 *  - every sheet already on file is renumbered inside its new scope, by the day
 *    it was observed. A run that reads 2, 5, 6 under the old count becomes
 *    1, 2, 3 — the numbers the observer would have written themselves.
 *
 * Numbers are assigned in ascending order of the number a sheet holds now, so a
 * sheet never moves onto a number a later sheet is still sitting on. Soft
 * deleted sheets are left alone: the index they would collide with excludes
 * them, and their number is a fact about a withdrawn sheet.
 *
 * Connects to Mongo directly rather than booting Nest: it touches one collection
 * and needs none of the graph.
 */

const NEW_INDEX_KEY = {
  teacherId: 1,
  observerId: 1,
  subjectId: 1,
  semesterId: 1,
  visitNumber: 1,
} as const;

interface SheetRow {
  _id: Types.ObjectId;
  teacherId: Types.ObjectId;
  observerId: Types.ObjectId;
  subjectId: Types.ObjectId;
  semesterId: Types.ObjectId;
  visitNumber: number;
  observedAt: Date;
}

/** The run a sheet belongs to: one observer's visits to one subject in one term. */
function scopeKey(sheet: SheetRow): string {
  return [sheet.teacherId, sheet.observerId, sheet.subjectId, sheet.semesterId]
    .map((id) => String(id))
    .join('|');
}

function sameKey(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = Object.entries(a);
  const right = Object.entries(b);
  return (
    left.length === right.length &&
    left.every(([field, direction], i) => right[i][0] === field && right[i][1] === direction)
  );
}

/**
 * A unique index that numbers visits, but not the way the schema now does.
 *
 * Matched by shape rather than by name so that every scope this rule has passed
 * through is cleaned up, whichever one the collection happens to be holding.
 */
function isStaleVisitIndex(index: { key: Record<string, unknown>; unique?: boolean }): boolean {
  return (
    index.unique === true &&
    'visitNumber' in index.key &&
    !sameKey(index.key, NEW_INDEX_KEY as unknown as Record<string, unknown>)
  );
}

async function main(): Promise<void> {
  const logger = new Logger('ObservationVisitScope');
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const sheets = connection.collection('teachingObservations');

  // ── The index ─────────────────────────────────────────────────────────────

  const indexes = (await sheets.indexes()) as {
    name: string;
    key: Record<string, unknown>;
    unique?: boolean;
  }[];
  const stale = indexes.filter(isStaleVisitIndex);

  for (const index of stale) {
    logger.log(`${dryRun ? '[dry run] ' : ''}dropping stale unique index ${index.name}`);
    if (!dryRun) await sheets.dropIndex(index.name);
  }
  if (stale.length === 0) logger.log('no stale unique index on the visit number');

  // ── The numbers ───────────────────────────────────────────────────────────

  const rows = (await sheets
    .find({ deletedAt: null })
    .project({
      teacherId: 1,
      observerId: 1,
      subjectId: 1,
      semesterId: 1,
      visitNumber: 1,
      observedAt: 1,
    })
    // The day it happened decides the order; the number it holds now breaks a
    // tie, and is also the order that keeps the renumbering collision-free.
    .sort({ observedAt: 1, visitNumber: 1 })
    .toArray()) as unknown as SheetRow[];

  const runs = new Map<string, SheetRow[]>();
  for (const row of rows) {
    const key = scopeKey(row);
    const run = runs.get(key);
    if (run) run.push(row);
    else runs.set(key, [row]);
  }

  const moves: { id: Types.ObjectId; from: number; to: number }[] = [];
  for (const run of runs.values()) {
    run.forEach((sheet, i) => {
      const to = i + 1;
      if (sheet.visitNumber !== to) moves.push({ id: sheet._id, from: sheet.visitNumber, to });
    });
  }

  logger.log(
    `${rows.length} sheet(s) on file in ${runs.size} run(s); ${moves.length} need renumbering`,
  );

  // Ascending by the number held now: a sheet only ever moves down, onto a
  // number whose previous holder has already moved further down.
  moves.sort((a, b) => a.from - b.from);

  for (const move of moves) {
    logger.log(`${dryRun ? '[dry run] ' : ''}${String(move.id)}: ຄັ້ງທີ ${move.from} → ${move.to}`);
    if (!dryRun) {
      await sheets.updateOne({ _id: move.id }, { $set: { visitNumber: move.to } });
    }
  }

  // ── The new index ─────────────────────────────────────────────────────────

  // Created here rather than left to the next boot's autoIndex, so the run that
  // renumbers is also the run that makes the new rule enforceable — and in that
  // order, because the build would fail on the duplicates it is about to fix.
  if (!dryRun) {
    await sheets.createIndex(NEW_INDEX_KEY, {
      unique: true,
      partialFilterExpression: { deletedAt: null },
    });
  }
  logger.log(`${dryRun ? '[dry run] ' : ''}unique index now on observer + teacher + subject`);

  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('ObservationVisitScope').error(error);
  process.exit(1);
});
