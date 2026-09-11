import { PipelineStage, Types } from 'mongoose';
import type { WrittenLesson } from './record-timeliness';

/**
 * The one thing this needs of a model, and no more.
 *
 * Not `Model<Attendance> | Model<BehaviorLog>`: Mongoose's `Model<T>` is
 * invariant in `T`, so a union would have to be widened at every call site and a
 * shared supertype does not exist. The aggregation is all that is used, so the
 * aggregation is all that is asked for — and both models satisfy it structurally.
 */
export interface AggregatesDocuments {
  aggregate<R>(pipeline: PipelineStage[]): { exec(): Promise<R[]> };
}

/**
 * When each class's day was written up, read once for both logs.
 *
 * The same aggregation over two collections, which both hold a lesson's
 * `teachingAssignmentId`, its `date` and a `createdAt` per row. Kept here beside
 * the rules rather than copied into each service, for the reason
 * `coverage-assignments.ts` exists: one grouping rule, one place to get it wrong.
 *
 * `$min: '$createdAt'` is the whole point. A roll call is a row per student and a
 * register row can name several, so the act of writing produced many documents in
 * one save; the earliest of them is when the teacher pressed it. Taking the
 * latest instead would date the write-up to whenever somebody last corrected a
 * single pupil's mark — turning a punctual teacher who fixed a typo a week later
 * into a late one.
 *
 * Grouped by day and not by period for the same reason: two periods of one class
 * on one day are filled in together, and `periodNumber` is optional on the
 * timetable anyway, so it cannot be relied on to tell them apart.
 */
export async function loadWrittenLessons(
  model: AggregatesDocuments,
  teachingAssignmentIds: string[],
  from: Date,
  to: Date,
): Promise<WrittenLesson[]> {
  if (teachingAssignmentIds.length === 0) return [];

  const rows = await model
    .aggregate<{ _id: { assignment: Types.ObjectId; date: Date }; recordedAt: Date }>([
      {
        $match: {
          teachingAssignmentId: {
            $in: teachingAssignmentIds.map((id) => new Types.ObjectId(id)),
          },
          date: { $gte: from, $lte: to },
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: { assignment: '$teachingAssignmentId', date: '$date' },
          recordedAt: { $min: '$createdAt' },
        },
      },
    ])
    .exec();

  return (
    rows
      // A row written before `timestamps` was on the schema has no `createdAt`, and
      // there is no honest way to date it. Dropped rather than dated to the epoch,
      // which would report it as years late.
      .filter((row) => row.recordedAt instanceof Date)
      .map<WrittenLesson>((row) => ({
        teachingAssignmentId: row._id.assignment.toString(),
        date: row._id.date.toISOString().slice(0, 10),
        recordedAt: row.recordedAt,
      }))
  );
}
