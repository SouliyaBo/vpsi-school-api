import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * One weekly period.
 *
 * Times are `"HH:mm"` strings rather than Date objects: class periods are local
 * wall-clock times with no date or timezone component, and lexicographic string
 * comparison on zero-padded `"HH:mm"` matches chronological order exactly, which
 * is what the overlap check relies on.
 */
@Schema({ _id: false })
export class SchedulePeriod {
  /** 0 = Sunday … 6 = Saturday, matching `Date#getDay()`. */
  @Prop({ type: Number, required: true, min: 0, max: 6 })
  dayOfWeek: number;

  @Prop({ type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  startTime: string;

  @Prop({ type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  endTime: string;

  /** Physical room. When set, it is also checked for double-booking. */
  @Prop({ type: String, default: null, trim: true })
  room?: string | null;

  /** Period number in the daily timetable, for display. */
  @Prop({ type: Number, default: null })
  periodNumber?: number | null;

  /**
   * A slot two teachers take turns in.
   *
   * The school runs some periods as a swap: in the last period on Friday, one
   * teacher takes ມ.2/ກ for maths while the other takes ມ.2/ຂ for Lao, and next
   * time round they trade. The paper timetable writes both subjects and both
   * teachers into one cell precisely because *which* way round it is that week
   * is left to the two teachers.
   *
   * Every arrangement of the swap is stored, so the slot looks like a triple
   * double-booking — the same teacher in two classes, the same class in two
   * lessons — when in fact only one arrangement runs on any given day. Marking
   * the period says so, and the clash check then ignores it against other
   * periods that say the same. It is deliberately mutual: a slot nobody else has
   * marked still clashes, so one flag cannot silently overwrite a normal lesson.
   *
   * Optional in the type rather than merely defaulted, because the clash check
   * reads candidates with `.lean()` — which skips Mongoose's defaults, so a
   * period stored before this field existed really does arrive as `undefined`.
   */
  @Prop({ type: Boolean, default: false })
  isRotating?: boolean;
}

export const SchedulePeriodSchema = SchemaFactory.createForClass(SchedulePeriod);

/**
 * One arrangement of a lesson's weekly periods, and the days it was in force.
 *
 * The timetable is not a fact about now — it is a fact about each day. Without
 * this it was only about now: `schedule` was replaced in place, and every report
 * derives which days a lesson was owed on by reading the *current* weekday. So
 * moving a lesson from Monday to Wednesday did not just change next week, it
 * changed every week behind it — the Mondays a teacher had actually taught and
 * marked stopped counting, and Wednesdays they had never taught appeared as gaps.
 * The punctuality report defaults to the whole term to date, so one timetable
 * revision rewrote the number the office judges every teacher by.
 *
 * Half-open `[from, to)` on UTC-midnight days, and the spells meet exactly —
 * `spell.to === next.from` — so a question about any day lands in one spell and
 * never between two.
 */
@Schema({ _id: false })
export class ScheduleSpell {
  @Prop({ type: [SchedulePeriodSchema], default: [] })
  schedule: SchedulePeriod[];

  /** Inclusive, at UTC midnight. */
  @Prop({ type: Date, required: true })
  from: Date;

  /** Exclusive; `null` while this is the arrangement in force. */
  @Prop({ type: Date, default: null })
  to?: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  changedBy?: Types.ObjectId | null;

  /** ເຫດຜົນ — why the timetable moved, e.g. `ປ່ຽນຕາຕະລາງພາກຮຽນ 2`. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;
}

export const ScheduleSpellSchema = SchemaFactory.createForClass(ScheduleSpell);

export type TeachingAssignmentDocument = HydratedDocument<TeachingAssignment>;

@Schema({ collection: 'teachingAssignments', ...baseSchemaOptions })
export class TeachingAssignment extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /**
   * The arrangement in force today.
   *
   * Everything that asks "when is this lesson" reads it — the roll-call sheet, the
   * entry forms, the clash check — so it stays denormalized rather than being
   * derived from `scheduleHistory` on every read. The two are kept in step in
   * exactly one place, `TeachingAssignmentsService.update`; nothing else writes
   * either.
   */
  @Prop({ type: [SchedulePeriodSchema], default: [] })
  schedule: SchedulePeriod[];

  /**
   * Every arrangement this lesson has had, oldest first — see `ScheduleSpell`.
   *
   * Empty means it has never been moved, and that is the honest reading: the
   * current schedule has applied for as long as anything asks about. So no
   * migration is owed, and a school that never revises its timetable carries no
   * extra rows.
   */
  @Prop({ type: [ScheduleSpellSchema], default: [] })
  scheduleHistory: ScheduleSpell[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String, default: null })
  notes?: string | null;
}

export const TeachingAssignmentSchema = SchemaFactory.createForClass(TeachingAssignment);

// The same teacher must not be assigned the same subject in the same class twice.
TeachingAssignmentSchema.index(
  { teacherId: 1, subjectId: 1, classroomId: 1, semesterId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// Drives both the teacher timetable view and the conflict check.
TeachingAssignmentSchema.index({ teacherId: 1, semesterId: 1, isActive: 1 });
TeachingAssignmentSchema.index({ classroomId: 1, semesterId: 1, isActive: 1 });
TeachingAssignmentSchema.index({ subjectId: 1, semesterId: 1 });
