import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';

/**
 * Casts `classrooms.homeroomTeacherId` from string to ObjectId.
 *
 *   npm run migrate:homeroom-teacher-ids -- --dry-run
 *   npm run migrate:homeroom-teacher-ids
 *
 * `@Prop({ type: Types.ObjectId })` does not cast what it is given: a string id
 * assigned to it is stored as a string, and from then on `{ homeroomTeacherId:
 * new Types.ObjectId(id) }` matches nothing and `populate` returns null. The
 * rooms read correctly on screen the whole time, because the screen only ever
 * reads the id back out — which is why this survived unnoticed.
 *
 * It stops being cosmetic the moment anything queries *by* homeroom teacher, as
 * the ວັນພຸດ/ວັນສຸກ reminder does: "the rooms this teacher is responsible for"
 * would come back empty for eleven of the twelve rooms, and eleven homeroom
 * teachers would simply never be reminded.
 *
 * Strings that are not valid ObjectIds are reported and left alone — that is a
 * different problem, and guessing at it here would hide it.
 */
async function main(): Promise<void> {
  const logger = new Logger('HomeroomTeacherIds');
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const classrooms = connection.collection('classrooms');

  const rooms = await classrooms
    .find({ deletedAt: null, homeroomTeacherId: { $type: 'string' } })
    .project({ name: 1, homeroomTeacherId: 1 })
    .toArray();

  const total = await classrooms.countDocuments({ deletedAt: null });
  logger.log(`${rooms.length} of ${total} classroom(s) hold the id as a string`);

  let fixed = 0;
  for (const room of rooms) {
    const raw = room.homeroomTeacherId as unknown as string;
    if (!Types.ObjectId.isValid(raw)) {
      logger.warn(`${String(room.name)}: "${raw}" is not a valid id — left as it is`);
      continue;
    }
    logger.log(`${dryRun ? '[dry run] ' : ''}${String(room.name)}: "${raw}" → ObjectId`);
    if (!dryRun) {
      await classrooms.updateOne(
        { _id: room._id },
        { $set: { homeroomTeacherId: new Types.ObjectId(raw) } },
      );
    }
    fixed += 1;
  }

  logger.log(`${dryRun ? '[dry run] ' : ''}done — ${fixed} cast, ${rooms.length - fixed} left`);
  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('HomeroomTeacherIds').error(error);
  process.exit(1);
});
