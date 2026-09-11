import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';

/**
 * Splits ທຳມະຊາດ and ສັງຄົມ into the subjects the mark sheet actually grades,
 * from ມ.4 up.
 *
 *   npm run migrate:split-subjects -- --dry-run
 *   npm run migrate:split-subjects
 *
 * The school teaches four ສາຍວິຊາ at every grade — that is what a teacher is
 * assigned to, what roll call is taken against and what a behaviour note is filed
 * under, and none of that changes here. What changes is marking: from ມ.4 the two
 * composite ສາຍວິຊາ are examined as separate subjects, each with its own ສອບເສັງ
 * and its own line on the report card, and the term average is their plain mean.
 *
 *   ມ.1–ມ.3   4 subjects   ພາສາລາວ-ວັນນະຄະດີ · ຄະນິດສາດ · ສັງຄົມ · ທຳມະຊາດ
 *   ມ.4, ມ.7  8 subjects   + ຟີຊິກ · ເຄມີ · ຊີວະ · ສຶກສາພົນລະເມືອງ · ພູມ · ປະຫວັດ
 *   ມ.5, ມ.6  7 subjects   the same without ຊີວະສາດ
 *
 * The parents are kept, not deleted: 79 teaching assignments, every attendance
 * row and every behaviour note point at them, and they are still the four
 * subjects the timetable runs on. `parentSubjectId` is what marks them as
 * taught-only, and the new rows as the ones that carry marks.
 *
 * Idempotent — it upserts on `code` and can be re-run after the office adds a
 * grade or changes a name. Connects to Mongo directly rather than booting Nest:
 * one collection, and it needs none of the graph.
 */

interface Split {
  /** Code prefix of the ສາຍວິຊາ being split, as it appears in `subjects.code`. */
  parent: string;
  children: { code: string; nameLo: string; nameEn: string; sortOrder: number }[];
}

/**
 * `sortOrder` is the order of the school's own list, which the printed sheet
 * columns follow: ພາສາລາວ-ວັນນະຄະດີ 1, ຄະນິດສາດ 2, then the six below.
 */
const PHYSICS = { code: 'PHYS', nameLo: 'ຟີຊິກສາດ', nameEn: 'Physics', sortOrder: 4 };
const CHEMISTRY = { code: 'CHEM', nameLo: 'ເຄມີສາດ', nameEn: 'Chemistry', sortOrder: 5 };
const BIOLOGY = { code: 'BIO', nameLo: 'ຊີວະສາດ', nameEn: 'Biology', sortOrder: 6 };
const CIVICS = {
  code: 'CIV',
  nameLo: 'ສຶກສາພົນລະເມືອງ',
  nameEn: 'Civic Education',
  sortOrder: 3,
};
const GEOGRAPHY = { code: 'GEO', nameLo: 'ພູມສາດ', nameEn: 'Geography', sortOrder: 7 };
const HISTORY = { code: 'HIST', nameLo: 'ປະຫວັດສາດ', nameEn: 'History', sortOrder: 8 };

/** Where the four ສາຍວິຊາ sit, for the grades that mark them as they stand. */
const PARENT_ORDER: Readonly<Record<string, number>> = { LAO: 1, MATH: 2, S: 3, N: 4 };

/** ມ.5 and ມ.6 sit no biology, which is the whole of the 8-vs-7 difference. */
const SOCIAL_SPLIT: Split = { parent: 'S', children: [CIVICS, GEOGRAPHY, HISTORY] };

const SPLITS_BY_GRADE: Readonly<Record<string, Split[]>> = {
  m4: [{ parent: 'N', children: [PHYSICS, CHEMISTRY, BIOLOGY] }, SOCIAL_SPLIT],
  m5: [{ parent: 'N', children: [PHYSICS, CHEMISTRY] }, SOCIAL_SPLIT],
  m6: [{ parent: 'N', children: [PHYSICS, CHEMISTRY] }, SOCIAL_SPLIT],
  m7: [{ parent: 'N', children: [PHYSICS, CHEMISTRY, BIOLOGY] }, SOCIAL_SPLIT],
};

/**
 * The name the school writes at the head of the ພາສາລາວ sheet.
 *
 * Applied only where the name is still the bare `ພາສາລາວ`, so an office edit is
 * never overwritten by a re-run.
 */
const LAO_RENAME = { from: 'ພາສາລາວ', to: 'ພາສາລາວ-ວັນນະຄະດີ' };

interface SubjectRow {
  _id: Types.ObjectId;
  code: string;
  nameLo: string;
  gradeLevelId: Types.ObjectId;
  subjectGroupId?: Types.ObjectId | null;
  parentSubjectId?: Types.ObjectId | null;
  sortOrder?: number;
}

async function main(): Promise<void> {
  const logger = new Logger('SplitUpperSubjects');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const gradeLevels = db.collection('gradeLevels');
  const subjects = db.collection<SubjectRow>('subjects');

  let created = 0;
  let linked = 0;
  let renamed = 0;

  for (const [gradeCode, splits] of Object.entries(SPLITS_BY_GRADE)) {
    const grade = await gradeLevels.findOne({ code: gradeCode, deletedAt: null });
    if (!grade) {
      logger.warn(`grade level ${gradeCode} not found — skipped`);
      continue;
    }

    for (const split of splits) {
      const parentCode = `${split.parent}-${gradeCode.toUpperCase()}`;
      const parent = await subjects.findOne({ code: parentCode, deletedAt: null });
      if (!parent) {
        logger.warn(`${parentCode} not found — nothing to split for ${gradeCode}`);
        continue;
      }

      for (const child of split.children) {
        const code = `${child.code}-${gradeCode.toUpperCase()}`;
        const existing = await subjects.findOne({ code });

        if (existing) {
          // Only the link and the column order are repaired: a name or a credit
          // the office has since corrected is theirs to keep.
          const alreadyLinked = existing.parentSubjectId?.toString() === parent._id.toString();
          if (alreadyLinked && existing.sortOrder === child.sortOrder) continue;
          logger.log(`link  ${code} → ${parentCode}`);
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
          linked += 1;
          continue;
        }

        logger.log(`create ${code} (${child.nameLo}) under ${parentCode}`);
        if (!dryRun) {
          await subjects.insertOne({
            _id: new Types.ObjectId(),
            code,
            nameLo: child.nameLo,
            nameEn: child.nameEn,
            gradeLevelId: grade._id as Types.ObjectId,
            // The department follows the ສາຍວິຊາ it was split out of: the split
            // is about examining, not about who runs the subject.
            subjectGroupId: parent.subjectGroupId ?? null,
            parentSubjectId: parent._id,
            type: 'core',
            // Every subject counts once — the school divides by the number of
            // subjects, not by a weight. `hoursPerWeek` is the office's to fill in.
            credits: 1,
            hoursPerWeek: 0,
            sortOrder: child.sortOrder,
            strands: [],
            passingPercentage: null,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as SubjectRow & Record<string, unknown>);
        }
        created += 1;
      }
    }
  }

  // The four ສາຍວິຊາ, so ມ.1–ມ.3 print in the school's order rather than by code.
  let ordered = 0;
  for (const [prefix, sortOrder] of Object.entries(PARENT_ORDER)) {
    const outcome = dryRun
      ? { modifiedCount: 0 }
      : await subjects.updateMany(
          {
            code: new RegExp(`^${prefix}-M\\d+$`),
            deletedAt: null,
            parentSubjectId: null,
            // Skipped when it is already right, so `updatedAt` is not churned and
            // the count below reports what actually moved.
            sortOrder: { $ne: sortOrder },
          },
          { $set: { sortOrder, updatedAt: new Date() } },
        );
    ordered += outcome.modifiedCount;
  }
  logger.log(`${dryRun ? '[dry run] ' : ''}ordered ${ordered} ສາຍວິຊາ`);

  const toRename = await subjects
    .find({ code: /^LAO-/, nameLo: LAO_RENAME.from, deletedAt: null })
    .toArray();
  for (const subject of toRename) {
    logger.log(`rename ${subject.code} → ${LAO_RENAME.to}`);
    if (!dryRun) {
      await subjects.updateOne(
        { _id: subject._id },
        { $set: { nameLo: LAO_RENAME.to, updatedAt: new Date() } },
      );
    }
    renamed += 1;
  }

  logger.log(
    `${dryRun ? '[dry run] ' : ''}created ${created}, linked ${linked}, renamed ${renamed}`,
  );

  // What every grade now grades, which is the divisor the term average uses.
  const parentIds = await subjects.distinct('parentSubjectId', {
    parentSubjectId: { $ne: null },
    deletedAt: null,
  });
  for (const grade of await gradeLevels.find({ deletedAt: null }).sort({ level: 1 }).toArray()) {
    const marked = await subjects
      .find({
        gradeLevelId: grade._id,
        isActive: true,
        deletedAt: null,
        _id: { $nin: parentIds as Types.ObjectId[] },
      })
      .sort({ sortOrder: 1, code: 1 })
      .toArray();
    logger.log(
      `${grade.code as string}: ${marked.length} marked — ${marked.map((s) => s.nameLo).join(', ')}`,
    );
  }

  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('SplitUpperSubjects').error(error);
  process.exit(1);
});
