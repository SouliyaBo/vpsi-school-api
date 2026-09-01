/**
 * Undoes the parts of `npm run seed` that overwrote the office's own edits when
 * it was run against the live database on 2026-08-31 (17:06 and 22:42).
 *
 * Every value written here was read back out of `auditLogs` — the last value a
 * person set through the app before the seed ran. The seed itself writes no audit
 * entries, which is why the damage had to be reconstructed rather than diffed.
 *
 * What it restores:
 *   - LAO-M1..M7  nameLo  ພາສາລາວ         -> ພາສາລາວ-ວັນນະຄະດີ   (set 2026-08-21)
 *   - LAO-M1..M7  group   ສາຍພາສາ         -> ສາຍສັງຄົມ            (set 2026-08-19)
 *   - group math  nameLo  ສາຍຄະນິດສາດ     -> ທຳມະຊາດ              (set 2026-08-11)
 *   - group math  head    6cb0ab          -> c45fa7                (set 2026-08-11)
 *   - the two semesters the seed invented for the 2025-2026 year -> soft-deleted
 *
 * NOT touched, because the pre-seed state cannot be proven from the audit trail:
 * the `languages` (ສາຍພາສາ) and `science` (ສາຍວິທະຍາສາດ) subject groups, which the
 * seed un-deleted. Both were last audited as deleted on 2026-08-11 with nothing
 * after, so they were most likely still deleted — but a seed un-delete leaves no
 * record, so re-deleting them is the office's call, not this script's.
 *
 * Usage:
 *   node scripts/undo-seed-2026-08-31.cjs           # dry run, writes nothing
 *   node scripts/undo-seed-2026-08-31.cjs --apply   # write the changes
 *
 * Run from the vpsischool-api directory: it reads MONGODB_URI out of .env.
 * Idempotent — a second run finds nothing to change.
 */
const { MongoClient, ObjectId } = require('mongodb');
const uri = require('fs').readFileSync('.env','utf8').match(/MONGODB_URI=(.+)/)[1].trim();
const APPLY = process.argv[2] === '--apply';
const SEED1 = new Date('2026-08-31T10:06:00Z');

(async () => {
  const c = await MongoClient.connect(uri); const db = c.db();
  const groups = await db.collection('subjectGroups').find({}).toArray();
  const social = groups.find(g => g.code === 'social');
  const plan = [];

  // 1 ── The seven LAO subjects: name and group, as last set through the app.
  const lao = await db.collection('subjects').find({ code: /^LAO-M/ }).sort({ code: 1 }).toArray();
  for (const s of lao) {
    const set = {};
    if (s.nameLo !== 'ພາສາລາວ-ວັນນະຄະດີ') set.nameLo = 'ພາສາລາວ-ວັນນະຄະດີ';
    if (String(s.subjectGroupId) !== String(social._id)) set.subjectGroupId = social._id;
    if (Object.keys(set).length) plan.push({ col: 'subjects', id: s._id, label: s.code, set });
  }

  // 2 ── The maths group, renamed and re-headed by the office on 08-11.
  const math = groups.find(g => g.code === 'math');
  if (math) {
    const set = {};
    if (math.nameLo !== 'ທຳມະຊາດ') set.nameLo = 'ທຳມະຊາດ';
    const wantHead = '6a7973097057c1c106c45fa7';
    if (String(math.headTeacherId) !== wantHead) set.headTeacherId = new ObjectId(wantHead);
    if (Object.keys(set).length) plan.push({ col: 'subjectGroups', id: math._id, label: 'group math', set });
  }

  // 3 ── The two semesters the seed invented for the 2025-2026 year.
  const newSemesters = await db.collection('semesters').find({ createdAt: { $gte: SEED1 } }).toArray();
  for (const sem of newSemesters) {
    plan.push({ col: 'semesters', id: sem._id, label: `semester ${sem.nameLo}`, set: { deletedAt: new Date() }, note: 'soft-delete (created by the seed)' });
  }

  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (nothing written) ===');
  for (const p of plan) {
    console.log(`${p.col}/${p.label}: ${JSON.stringify(p.set)}${p.note ? '  — ' + p.note : ''}`);
  }
  console.log(`\n${plan.length} document(s) to change`);

  if (APPLY) {
    for (const p of plan) {
      await db.collection(p.col).updateOne({ _id: p.id }, { $set: p.set });
    }
    console.log('done');
  }
  await c.close();
})().catch(e=>console.error('ERR', e.message));
