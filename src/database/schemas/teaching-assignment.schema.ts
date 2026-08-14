import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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

export type TeachingAssignmentDocument = HydratedDocument<TeachingAssignment>;

@Schema({ collection: 'teachingAssignments', ...baseSchemaOptions })
export class TeachingAssignment extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: [SchedulePeriodSchema], default: [] })
  schedule: SchedulePeriod[];

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
