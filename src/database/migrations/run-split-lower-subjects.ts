import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';

/**
 * Splits ສັງຄົມ and ທຳມະຊາດ at ມ.1–ມ.3 into the subjects the mark sheet grades,
 * the way they are split at ມ.5 and ມ.6 — and moves the marks already written.
 *
 *   npm run migrate:split-lower-subjects -- --dry-run
 *   npm run migrate:split-lower-subjects
 *
 * Asked for by the office on 20 Oct 2026: ສັງຄົມ first, then ທຳມະຊາດ "like ມ.5
 * and ມ.6", which split it into ຟີຊິກສາດ and ເຄມີສາດ with no ຊີວະສາດ. As from
 * ມ.4 up it is a split for **marking only**: the two ສາຍວິຊາ stay the subjects
 * that are taught, so teaching assignments, roll call, behaviour notes and the
 * timetable all keep pointing at them, and their teacher is who may mark the
 * subjects under them (see `SubjectsService.markingParentOf`).
 *
 *   before   ມ.1–ມ.3   4 subjects   ພາສາລາວ-ວັນນະຄະດີ · ຄະນິດສາດ · ສັງຄົມ · ທຳມະຊາດ
 *   after    ມ.1–ມ.3   7 subjects   ພາສາລາວ-ວັນນະຄະດີ · ຄະນິດສາດ · ສຶກສາພົນລະເມືອງ ·
 *                                   ຟີຊິກສາດ · ເຄມີສາດ · ພູມສາດ · ປະຫວັດສາດ — ÷ 7
 *
 * Each is a full subject — its own ສອບເສັງ, its own ພາກຮຽນ, its own line on the
 * report card — and is marked on the columns its ສາຍວິຊາ was marked on, copied
 * from the parent: ສັງຄົມ's 1 · 0 · 3 · 6, ທຳມະຊາດ's standard 1 · 1 · 2 · 6.
 * `migrate:nine-point-subjects`, run after this, then puts the three social
 * subjects on 9; ຟີຊິກ and ເຄມີ stay out of 10.
 *
 * **The marks already written are copied into every subject of the split, then
 * retired from the ສາຍວິຊາ** (the office's choice: no blank months, teachers
 * correct each subject afterwards). Retired means soft-deleted, so nothing is
 * lost and a row can be restored by clearing its `deletedAt`. They cannot stay
 * live: the term result reads every live monthly row in a class, and the parent
 * would count as one more subject. Monthly rows and ສອບເສັງ/ເພີ່ມ rows are both
 * moved, locks and ເຫດຜົນ included. Every stored term result of these grades is
 * then flagged stale, so publication waits until each class is recomputed on the
 * new divisor.
 *
 * Idempotent: subjects are upserted on `code`, a copy already present is not
 * written twice, and a parent's row is only retired once all its copies exist.
 * Connects to Mongo directly rather than booting Nest, like the ມ.4 split.
 */

const GRADES = ['m1', 'm2', 'm3'] as const;

type Columns = { attendance: number; notebook: number; activity: number; test: number };

interface Split {
  /** Code prefix of the ສາຍວິຊາ, as in `subjects.code`. */
  parent: string;
  /** The same codes, names and sheet order as the ມ.4 split (`migrate:split-subjects`). */
  children: { code: string; nameLo: string; nameEn: string; sortOrder: number }[];
  /** What the children are marked on should the parent carry no scheme of its own. */
  fallbackColumns: Columns | null;
}

const SPLITS: Split[] = [
  {
    parent: 'S',
    children: [
      { code: 'CIV', nameLo: 'ສຶກສາພົນລະເມືອງ', nameEn: 'Civic Education', sortOrder: 3 },
      { code: 'GEO', nameLo: 'ພູມສາດ', nameEn: 'Geography', sortOrder: 7 },
      { code: 'HIST', nameLo: 'ປະຫວັດສາດ', nameEn: 'History', sortOrder: 8 },
    ],
    // ສັງຄົມ keeps no ປື້ມ mark.
    fallbackColumns: { attendance: 1, notebook: 0, activity: 3, test: 6 },
  },
  {
    // As at ມ.5 and ມ.6: no ຊີວະສາດ.
    parent: 'N',
    children: [
      { code: 'PHYS', nameLo: 'ຟີຊິກສາດ', nameEn: 'Physics', sortOrder: 4 },
      { code: 'CHEM', nameLo: 'ເຄມີສາດ', nameEn: 'Chemistry', sortOrder: 5 },
    ],
    // The standard columns, which a subject carries as no override at all.
    fallbackColumns: null,
  },
];

interface SubjectRow {
  _id: Types.ObjectId;
  code: string;
  nameLo: string;
  gradeLevelId: Types.ObjectId;
  subjectGroupId?: Types.ObjectId | null;
  parentSubjectId?: Types.ObjectId | null;
  monthlyColumnMax?: Columns | null;
  sortOrder?: number;
}

interface MarkRow {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  subjectId: Types.ObjectId;
  semesterId: Types.ObjectId;
  month?: number;
  strand?: string | null;
  remark?: string | null;
  isLocked?: boolean;
  deletedAt?: Date | null;
  [field: string]: unknown;
}

async function main(): Promise<void> {
  const logger = new Logger('SplitLowerSubjects');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const gradeLevels = db.collection('gradeLevels');
  const classrooms = db.collection('classrooms');
  const subjects = db.collection<SubjectRow>('subjects');
  const termResults = db.collection('termResults');

  const totals = { created: 0, linked: 0, copied: 0, retired: 0, stale: 0 };

  for (const gradeCode of GRADES) {
    const grade = await gradeLevels.findOne({ code: gradeCode, deletedAt: null });
    if (!grade) {
      logger.warn(`grade level ${gradeCode} not found — skipped`);
      continue;
    }

    for (const split of SPLITS) {
      const parentCode = `${split.parent}-${gradeCode.toUpperCase()}`;
      const parent = await subjects.findOne({ code: parentCode, deletedAt: null });
      if (!parent) {
        logger.warn(`${parentCode} not found — nothing to split for ${gradeCode}`);
        continue;
      }
      const columns = parent.monthlyColumnMax ?? split.fallbackColumns;

      // ── The subject rows ───────────────────────────────────────────────────
      const childIds: Types.ObjectId[] = [];
      for (const child of split.children) {
        const code = `${child.code}-${gradeCode.toUpperCase()}`;
        const existing = await subjects.findOne({ code });

        if (existing) {
          childIds.push(existing._id);
          // Only the link and the column order are repaired: a name or a scheme
          // the office has since corrected is theirs to keep.
          const alreadyLinked = existing.parentSubjectId?.toString() === parent._id.toString();
          if (alreadyLinked && existing.sortOrder === child.sortOrder) continue;
          logger.log(`link   ${code} → ${parentCode}`);
          if (!dryRun) {
            await subjects.updateOne(
              { _id: existing._id },
              {
                $set: {
                  parentSubjectId: parent._id,
                  sortOrder: child.sortOrder,
                  deletedAt: null,
                  updatedAt: new Date(),
                },
              },
            );
          }
          totals.linked += 1;
          continue;
        }

        const id = new Types.ObjectId();
        childIds.push(id);
        logger.log(`create ${code} (${child.nameLo}) under ${parentCode}`);
        if (!dryRun) {
          await subjects.insertOne({
            _id: id,
            code,
            nameLo: child.nameLo,
            nameEn: child.nameEn,
            gradeLevelId: grade._id as Types.ObjectId,
            subjectGroupId: parent.subjectGroupId ?? null,
            parentSubjectId: parent._id,
            type: 'core',
            // Every subject counts once — the school divides by the number of
            // subjects, not by a weight. `hoursPerWeek` is the office's to fill in.
            credits: 1,
            hoursPerWeek: 0,
            sortOrder: child.sortOrder,
            strands: [],
            monthlyColumnMax: columns ? { ...columns } : null,
            passingPercentage: null,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as SubjectRow & Record<string, unknown>);
        }
        totals.created += 1;
      }

      // ── The marks already written under the ສາຍວິຊາ ──────────────────────
      for (const [collection, keyOf] of [
        [
          'monthlyMarks',
          (row: MarkRow) => ({ month: row.month, strand: row.strand ?? null }),
        ] as const,
        ['subjectTermMarks', () => ({})] as const,
      ]) {
        const marks = db.collection<MarkRow>(collection);
        const rows = await marks.find({ subjectId: parent._id, deletedAt: null }).toArray();
        let copied = 0;
        let locked = 0;
        let withRemark = 0;

        for (const row of rows) {
          for (const childId of childIds) {
            const present = await marks.findOne({
              studentId: row.studentId,
              subjectId: childId,
              semesterId: row.semesterId,
              ...keyOf(row),
              deletedAt: null,
            });
            if (present) continue;
            if (!dryRun) {
              await marks.insertOne({
                ...row,
                _id: new Types.ObjectId(),
                subjectId: childId,
                updatedAt: new Date(),
              } as MarkRow);
            }
            copied += 1;
          }
          if (row.isLocked) locked += 1;
          if (row.remark) withRemark += 1;

          // In a dry run the copies were never written, so the retirement is
          // counted rather than checked.
          if (!dryRun) {
            await marks.updateOne(
              { _id: row._id },
              { $set: { deletedAt: new Date(), updatedAt: new Date() } },
            );
          }
          totals.retired += 1;
        }

        totals.copied += copied;
        if (rows.length > 0) {
          logger.log(
            `  ${parentCode} ${collection}: ${rows.length} row(s) → ${copied} copies ` +
              `(${locked} in a submitted month, ${withRemark} with ເຫດຜົນ), originals retired`,
          );
        }
      }
    }

    // ── Stored term results now divide by the wrong number of subjects ────────
    const roomIds = await classrooms.distinct('_id', { gradeLevelId: grade._id });
    const filter = { classroomId: { $in: roomIds }, deletedAt: null, isStale: { $ne: true } };
    const staleCount = dryRun
      ? await termResults.countDocuments(filter)
      : (
          await termResults.updateMany(filter, {
            $set: { isStale: true, staleSince: new Date() },
          })
        ).modifiedCount;
    totals.stale += staleCount;
  }

  const prefix = dryRun ? '[dry run] ' : '';
  logger.log(
    `${prefix}subjects: ${totals.created} created, ${totals.linked} linked · ` +
      `marks: ${totals.copied} copied, ${totals.retired} ສາຍວິຊາ row(s) retired · ` +
      `${totals.stale} term result(s) flagged stale — recompute those classes`,
  );

  // What every lower grade now marks, which is the divisor the term average uses.
  const parentIds = await subjects.distinct('parentSubjectId', {
    parentSubjectId: { $ne: null },
    deletedAt: null,
  });
  for (const gradeCode of GRADES) {
    const grade = await gradeLevels.findOne({ code: gradeCode, deletedAt: null });
    if (!grade) continue;
    const marked = await subjects
      .find({
        gradeLevelId: grade._id,
        isActive: true,
        deletedAt: null,
        _id: { $nin: parentIds as Types.ObjectId[] },
      })
      .sort({ sortOrder: 1, code: 1 })
      .toArray();
    logger.log(`${gradeCode}: ${marked.length} marked — ${marked.map((s) => s.nameLo).join(', ')}`);
  }

  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('SplitLowerSubjects').error(error);
  process.exit(1);
});
