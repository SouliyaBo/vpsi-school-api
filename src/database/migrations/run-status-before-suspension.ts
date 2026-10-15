import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';

/**
 * Fills `statusBeforeSuspension` on the children who were suspended before the
 * field existed, from the audit log.
 *
 *   npm run migrate:status-before-suspension -- --dry-run
 *   npm run migrate:status-before-suspension
 *
 * The district report leaves out a child who had already declined the
 * certificate (`no_certificate`) and then stopped coming; the service records
 * that on every suspension from now on, and this recovers it for the ones made
 * earlier. The audit row of the change carries the old status in `oldValue`.
 *
 * A suspended child with no such row — imported as suspended, or changed before
 * auditing — is left empty and listed: nothing on file says what they were.
 *
 * Idempotent: a child who already has the field is skipped.
 */

interface StudentRow {
  _id: Types.ObjectId;
  studentCode: string;
}

interface AuditRow {
  oldValue?: { status?: string } | null;
}

async function main(): Promise<void> {
  const logger = new Logger('StatusBeforeSuspension');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const db = connection.db;
  if (!db) throw new Error('no database on the connection');

  const students = await db
    .collection<StudentRow>('students')
    .find(
      { status: 'suspended', deletedAt: null, statusBeforeSuspension: { $in: [null, undefined] } },
      { projection: { studentCode: 1 } },
    )
    .toArray();

  const unknown: string[] = [];
  let filled = 0;
  for (const student of students) {
    // The latest change *into* suspended is the one the suspension dates from.
    const [change] = await db
      .collection<AuditRow>('auditLogs')
      .find({
        entityType: 'students',
        entityId: student._id,
        'newValue.status': 'suspended',
        'oldValue.status': { $exists: true, $ne: 'suspended' },
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();
    const before = change?.oldValue?.status;
    if (!before) {
      unknown.push(student.studentCode);
      continue;
    }
    logger.log(`${student.studentCode}: ${before} → suspended`);
    if (!dryRun) {
      await db
        .collection('students')
        .updateOne({ _id: student._id }, { $set: { statusBeforeSuspension: before } });
    }
    filled += 1;
  }

  const prefix = dryRun ? '[dry run] ' : '';
  logger.log(`${prefix}${filled} of ${students.length} suspended student(s) filled`);
  if (unknown.length > 0) {
    logger.warn(`no status change on file, left empty: ${unknown.join(', ')}`);
  }
  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('StatusBeforeSuspension').error(error);
  process.exit(1);
});
