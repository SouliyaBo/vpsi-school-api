import { Logger } from '@nestjs/common';
import { connect, connection } from 'mongoose';
import { DEFAULT_GRADE_SCALE } from 'src/modules/term-results/grading';

/**
 * Puts the `grading.scale` setting onto the school's own A–F bands.
 *
 *   npm run migrate:grade-scale -- --dry-run
 *   npm run migrate:grade-scale
 *
 * The seeded scale was a generic A/B+/B/C+/C/D+/D/F at 80/75/70/65/60/55/50 —
 * a placeholder from before the office gave theirs, which is A–F **with an E**
 * and no `+` bands:
 *
 *   A 8.5–10 · B 7–8.4 · C 5.5–6.9 · D 4.5–5.4 · E 3.5–4.4 · F 0–3.4
 *
 * Only this one key is touched. `npm run seed:settings` would do it too, but it
 * `$set`s all twenty-odd settings back to their seeded values and would undo
 * anything the office has since changed.
 *
 * Stored term results keep whatever letter they were computed with until the
 * class is recomputed — that is what `computationVersion` is for, and 3 is this
 * change. Any result still showing `B+` is a result nobody has recomputed.
 */
async function main(): Promise<void> {
  const logger = new Logger('GradeScale');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const settings = db.collection('settings');
  const current = await settings.findOne({ key: 'grading.scale' });
  logger.log(`before: ${JSON.stringify(current?.value ?? null)}`);
  logger.log(`after:  ${JSON.stringify(DEFAULT_GRADE_SCALE)}`);

  if (!dryRun) {
    await settings.updateOne(
      { key: 'grading.scale' },
      {
        $set: {
          key: 'grading.scale',
          value: DEFAULT_GRADE_SCALE,
          category: 'grading',
          isPublic: false,
          isSystem: true,
          deletedAt: null,
          description:
            "The school's grade bands, as percentages. Changing this should be paired with a " +
            'COMPUTATION_VERSION bump.',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  const stale = await db.collection('termResults').countDocuments({
    computationVersion: { $lt: 3 },
    deletedAt: null,
  });
  logger.log(
    `${dryRun ? '[dry run] ' : ''}done — ${stale} stored term result(s) still on an older ` +
      'computation and needing a recompute',
  );

  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('GradeScale').error(error);
  process.exit(1);
});
