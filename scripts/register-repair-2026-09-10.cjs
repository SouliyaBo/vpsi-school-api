/**
 * ຊ່ອມແປງທະບຽນນັກຮຽນ — a one-off repair of the register, 10 September 2026.
 *
 * Five faults, all of them the same age as the school year and all of them
 * visible on the roll-call screen the office reported:
 *
 *   1. a duplicate ວິຣິສາ ພົນອາມາດ (code `599`) alongside the record the office
 *      keeps (`0599`), enrolled twice in ມ.6 and marked present twice on three
 *      days;
 *   2. roll-call rows filed against students who have since been deleted;
 *   3. snapshots of a student's code and name left stale on their placement
 *      after the office corrected the student record;
 *   4. five classes carrying a duplicated roll number and a gap — the register
 *      used to issue `currentCount + 1`, which reuses a number as soon as
 *      anybody leaves;
 *   5. six classrooms whose cached `currentCount` had drifted from the number of
 *      open placements.
 *
 * Everything it touches is written to `data/backups/` first, and every change
 * leaves an audit row under the username `data-repair`, so the trail explains
 * what happened to a name that moved or vanished.
 *
 * Nothing is hard-deleted: rows are closed the way the app closes them, with
 * `deletedAt`.
 *
 * Safe to run twice — each step is written as "bring this to where it should
 * be", so a second run finds nothing to do. The causes are fixed in the code
 * (StudentsService.closePlacements / syncStudentCode, ClassroomsService
 * .nextRollNumber); this only cleans up what they let through.
 */
const { MongoClient, ObjectId } = require('mongodb');
const { writeFileSync, mkdirSync } = require('fs');
require('dotenv').config();

const oid = (value) => new ObjectId(value);

/** ວິຣິສາ ພົນອາມາດ entered twice; the office keeps `0599` and drops this one. */
const DUPLICATE_STUDENT = '6a8baf041f795a4e457ec92e';
const REASON = 'ຊ່ອມແປງທະບຽນ 10/09/2026: ລຶບບັນທຶກຊ້ຳ, ຈັດລຳດັບໃໝ່, ແກ້ຂໍ້ມູນທີ່ຄ້າງ';

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const students = db.collection('students');
  const enrollments = db.collection('enrollments');
  const attendances = db.collection('attendances');
  const classrooms = db.collection('classrooms');
  const now = new Date();

  const trail = [];
  const audit = (action, entityType, entityId, oldValue, newValue) =>
    trail.push({
      userId: null,
      username: 'data-repair',
      action,
      entityType,
      entityId,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      ip: null,
      userAgent: null,
      reason: REASON,
      createdAt: now,
      updatedAt: now,
    });

  // ── What is about to change, written down before any of it does ───────────
  const liveIds = new Set(
    (await students.find({}, { projection: { _id: 1 } }).toArray()).map((s) => String(s._id)),
  );
  const duplicate = await students.findOne({ _id: oid(DUPLICATE_STUDENT) });
  const duplicateEnrollments = await enrollments
    .find({ studentId: oid(DUPLICATE_STUDENT), deletedAt: null })
    .toArray();
  const duplicateAttendance = await attendances
    .find({ studentId: oid(DUPLICATE_STUDENT), deletedAt: null })
    .toArray();
  const orphanAttendance = (await attendances.find({ deletedAt: null }).toArray()).filter(
    (row) => !liveIds.has(String(row.studentId)) && String(row.studentId) !== DUPLICATE_STUDENT,
  );
  const roster = await enrollments.find({ deletedAt: null }).toArray();
  const rooms = await classrooms.find({ deletedAt: null }).toArray();

  mkdirSync('data/backups', { recursive: true });
  const file = `data/backups/register-repair-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        why: REASON,
        duplicate,
        duplicateEnrollments,
        duplicateAttendance,
        orphanAttendance,
        enrollments: roster,
        classrooms: rooms.map((room) => ({
          _id: room._id,
          name: room.name,
          currentCount: room.currentCount,
        })),
      },
      null,
      2,
    ),
  );
  console.log('backup →', file);

  // ── 1. The duplicate record, and everything filed under it ────────────────
  if (duplicate && !duplicate.deletedAt) {
    for (const enrollment of duplicateEnrollments) {
      if (enrollment.status === 'active') {
        await classrooms.updateOne({ _id: enrollment.classroomId }, { $inc: { currentCount: -1 } });
      }
      await enrollments.updateOne(
        { _id: enrollment._id },
        { $set: { deletedAt: now, deletedBy: null } },
      );
      audit('delete', 'enrollments', enrollment._id, enrollment);
    }
    // Its three roll-call rows are the same child on days the kept record
    // already covers — 18, 24 and 25 August, same lesson, same period.
    for (const row of duplicateAttendance) {
      await attendances.updateOne({ _id: row._id }, { $set: { deletedAt: now, deletedBy: null } });
      audit('delete', 'attendances', row._id, row);
    }
    await students.updateOne({ _id: duplicate._id }, { $set: { deletedAt: now, deletedBy: null } });
    audit('delete', 'students', duplicate._id, duplicate);
    console.log(
      `duplicate ${duplicate.studentCode} closed —`,
      `${duplicateEnrollments.length} placement, ${duplicateAttendance.length} roll-call rows`,
    );
  }

  // ── 2. Roll-call rows left behind by students already deleted ─────────────
  for (const row of orphanAttendance) {
    await attendances.updateOne({ _id: row._id }, { $set: { deletedAt: now, deletedBy: null } });
    audit('delete', 'attendances', row._id, row);
  }
  console.log('orphan roll-call rows closed:', orphanAttendance.length);

  // ── 3. Snapshots that no longer match the student record ──────────────────
  const byId = new Map(
    (await students.find({}).project({ studentCode: 1, firstNameLo: 1, lastNameLo: 1 }).toArray())
      .map((student) => [String(student._id), student]),
  );
  for (const name of ['enrollments', 'examRegistrations', 'termResults']) {
    for (const row of await db.collection(name).find({}).toArray()) {
      const student = byId.get(String(row.studentId));
      if (!student) continue;
      const patch = {};
      if (row.studentCode !== undefined && row.studentCode !== student.studentCode) {
        patch.studentCode = student.studentCode;
      }
      const registerName = `${student.firstNameLo} ${student.lastNameLo}`;
      if (row.studentNameLo !== undefined && row.studentNameLo !== registerName) {
        patch.studentNameLo = registerName;
      }
      if (Object.keys(patch).length === 0) continue;
      await db.collection(name).updateOne({ _id: row._id }, { $set: patch });
      audit(
        'update',
        name,
        row._id,
        { studentCode: row.studentCode, studentNameLo: row.studentNameLo },
        patch,
      );
      console.log(` ${name}`, String(row._id), JSON.stringify(patch));
    }
  }

  // ── 4. One roll number each, in the order the register already reads ──────
  for (const room of rooms) {
    const roll = await enrollments
      .find({ classroomId: room._id, status: 'active', deletedAt: null })
      .sort({ rollNumber: 1, enrolledAt: 1, _id: 1 })
      .toArray();
    const moved = [];
    for (const [index, enrollment] of roll.entries()) {
      const number = index + 1;
      if (enrollment.rollNumber === number) continue;
      await enrollments.updateOne({ _id: enrollment._id }, { $set: { rollNumber: number } });
      audit(
        'update',
        'enrollments',
        enrollment._id,
        { rollNumber: enrollment.rollNumber },
        { rollNumber: number },
      );
      moved.push(`${enrollment.studentNameLo} ${enrollment.rollNumber}→${number}`);
    }
    if (moved.length) console.log(` ${room.name}: ${moved.join(' | ')}`);
  }

  // ── 5. The cached roster sizes, recomputed from the register ──────────────
  for (const room of rooms) {
    const actual = await enrollments.countDocuments({
      classroomId: room._id,
      status: 'active',
      deletedAt: null,
    });
    const cached = await classrooms.findOne({ _id: room._id });
    if (actual === cached.currentCount) continue;
    await classrooms.updateOne({ _id: room._id }, { $set: { currentCount: actual } });
    audit('update', 'classrooms', room._id, { currentCount: cached.currentCount }, { currentCount: actual });
    console.log(` ${room.name}: count ${cached.currentCount} → ${actual}`);
  }

  if (trail.length) await db.collection('auditLogs').insertMany(trail);
  console.log('\naudit rows written:', trail.length);
  await client.close();
})();
