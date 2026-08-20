import { Logger } from '@nestjs/common';
import { connect, connection } from 'mongoose';
import { GENDERS, TITLE_BY_GENDER } from 'src/common/constants/enums';

/**
 * Drops the stored `title` from every student, now that it is a virtual.
 *
 *   npm run migrate:student-title -- --dry-run
 *   npm run migrate:student-title
 *
 * The register wrote the same two honorifics four ways — `ນາງ`, `ນ.`, `ທ້າວ`,
 * `ທ.`, plus blanks — which is typing rather than meaning. Since the honorific
 * is fully determined by the gender, `StudentSchema` derives it on read and the
 * stored copy is now a second answer that can only drift from the first.
 *
 * Students whose gender is not one of the two the register has are left exactly
 * as they are and reported instead. Their honorific cannot be derived, so
 * removing the stored one would lose the only clue on file — and picking a
 * gender for them is the office's call, not this script's.
 *
 * Teachers keep their stored `title`: an adult male teacher is addressed `ທ່ານ`,
 * not `ທ້າວ`, so the student rule does not carry across and their honorific is
 * not derivable from gender alone.
 *
 * Connects to Mongo directly rather than booting Nest: it touches one collection
 * with two statements and needs none of the graph.
 */
async function main(): Promise<void> {
  const logger = new Logger('DropStudentTitle');
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const students = connection.collection('students');

  // Read before writing, so the report describes what was actually on file.
  const stored = await students
    .aggregate<{ _id: string | null; n: number }>([{ $group: { _id: '$title', n: { $sum: 1 } } }])
    .toArray();

  const ungendered = await students
    .find({ gender: { $nin: GENDERS } })
    .project({ studentCode: 1, gender: 1, firstNameLo: 1, lastNameLo: 1 })
    .toArray();

  logger.log(
    `stored titles: ${stored.map((row) => `${row._id ?? '(blank)'}=${row.n}`).join(', ')}`,
  );
  logger.log(
    `derived from gender: ${Object.entries(TITLE_BY_GENDER)
      .map(([gender, title]) => `${gender}→${title}`)
      .join(', ')}`,
  );

  for (const student of ungendered) {
    logger.warn(
      `${student.studentCode} ${student.firstNameLo} ${student.lastNameLo}: ` +
        `gender is "${String(student.gender)}" — kept as it is, and its honorific ` +
        `cannot be derived until the office records a gender`,
    );
  }

  if (dryRun) {
    logger.log(
      `--dry-run: would unset title on ${await students.countDocuments({ title: { $exists: true } })} students`,
    );
  } else {
    const result = await students.updateMany({}, { $unset: { title: '' } });
    logger.log(`unset title on ${result.modifiedCount} students`);
  }

  logger.log(
    ungendered.length === 0
      ? 'every student has a gender on file'
      : `${ungendered.length} student(s) still need a gender before their honorific resolves`,
  );

  await connection.close();
}

void main().catch((error: unknown) => {
  new Logger('DropStudentTitle').error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
