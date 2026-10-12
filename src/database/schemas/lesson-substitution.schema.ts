import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

export type LessonSubstitutionDocument = HydratedDocument<LessonSubstitution>;

/**
 * ການມອບໝາຍສອນແທນ — one day's lesson taken by a teacher who is not on the
 * timetable for it.
 *
 * The register and the behaviour log are both written by "the teacher of this
 * lesson", which the timetable answers — so on the ordinary day a colleague
 * stands in for someone who is away, the person actually in the room could not
 * write either of them, and the office had to key it in from a note. This is the
 * missing fact: not a second timetable, but a claim against one day of one
 * existing lesson.
 *
 * Deliberately **not** a second `TeachingAssignment`. Adding one would collide
 * with the unique index on (teacher, subject, class, term), trip the clash check
 * in `schedule-conflict.ts`, and double the denominator of every coverage,
 * punctuality and workload figure for the rest of the term — a day's cover would
 * be paid for with a term of wrong reports.
 *
 * It carries two teachers, and both are load-bearing:
 *
 * - `substituteTeacherId` is who may write the lesson up, and who the coverage
 *   and punctuality reports hold responsible for that day. Without this the
 *   teacher who was off sick appears in the report as the one who never marked
 *   the roll.
 * - `ownerTeacherId` is a snapshot of who the timetable said owned it when the
 *   claim was made. Not read back through the assignment, because the office
 *   reassigns lessons mid-term: a claim has to keep saying who was stood in for,
 *   even after the answer on the timetable has changed.
 *
 * Withdrawal is the ordinary soft delete. `deletedAt` is what the unique index
 * and every read filter on, so revoking a claim both frees the day for another
 * teacher to claim and hands responsibility for it back to the timetabled
 * teacher — one field, rather than a second "revoked" axis that every query
 * would have to remember.
 */
@Schema({ collection: 'lessonSubstitutions', ...baseSchemaOptions })
export class LessonSubstitution extends SoftDeletableDocument {
  /** The timetabled lesson being stood in for. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'TeachingAssignment', required: true, index: true })
  teachingAssignmentId: Types.ObjectId;

  /**
   * The school day, at UTC midnight.
   *
   * One claim covers the whole of that day's teaching of this lesson rather than
   * a single period: the paperwork is filed per class per day — see
   * `record-timeliness` — so a claim per period would be a finer grain than
   * anything that reads it, and the two periods of a double would need two.
   */
  @Prop({ type: Date, required: true })
  date: Date;

  /** The teacher who took the lesson, and who owes its paperwork. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  substituteTeacherId: Types.ObjectId;

  /** Who the timetable said owned the lesson when the claim was made. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  ownerTeacherId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true })
  subjectId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /**
   * ເຫດຜົນ — why the timetabled teacher was not there.
   *
   * Free text and optional, like the behaviour register's own fields: the honest
   * answers ("ລາປ່ວຍ", "ໄປຮາຊະການ", "ຄູຍັງບໍ່ມາ") are a short list the office
   * already uses on paper, and demanding a category before a teacher can mark
   * the roll would cost the school the roll call to gain a statistic.
   */
  @Prop({ type: String, default: null, trim: true })
  reason?: string | null;

  /**
   * Whoever pressed the button.
   *
   * Distinct from `substituteTeacherId` for the same reason `recordedBy` is
   * distinct from `teacherId` on the register: a teacher claims their own cover,
   * but the office may also file one on their behalf, and "who took the lesson"
   * must still answer the teacher rather than the clerk.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  claimedBy: Types.ObjectId;
}

export const LessonSubstitutionSchema = SchemaFactory.createForClass(LessonSubstitution);

/**
 * One live claim per lesson per day.
 *
 * This is the whole of the concurrency control on a self-service claim: two
 * teachers who each believe they are covering the same period race here, and the
 * second one is told the lesson is already claimed instead of quietly replacing
 * the first. Partial on `deletedAt` so a withdrawn claim leaves the day free.
 */
LessonSubstitutionSchema.index(
  { teachingAssignmentId: 1, date: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// "Which lessons did I cover" — the read that keeps a stand-in's own coverage and
// punctuality rows honest, since the timetable does not list those lessons
// under their name.
LessonSubstitutionSchema.index({ substituteTeacherId: 1, date: 1 });
// "Which of my lessons did somebody else take" — the timetabled teacher's view,
// and what the report reads to hand a day's responsibility over.
LessonSubstitutionSchema.index({ ownerTeacherId: 1, date: 1 });
// Every claim inside a report's window, in one read.
LessonSubstitutionSchema.index({ semesterId: 1, date: 1 });
