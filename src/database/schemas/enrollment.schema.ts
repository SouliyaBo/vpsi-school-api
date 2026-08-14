import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ENROLLMENT_STATUSES, EnrollmentStatus } from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

export type EnrollmentDocument = HydratedDocument<Enrollment>;

/**
 * A student's placement in one classroom for one school year.
 *
 * Kept as its own collection rather than embedded in `classrooms` because a
 * student's enrollment history across years is a first-class query.
 */
@Schema({ collection: 'enrollments', ...baseSchemaOptions })
export class Enrollment extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  /** denormalized from Student — immutable, lets class rosters render without a lookup */
  @Prop({ type: String, required: true })
  studentCode: string;

  /** denormalized from Student */
  @Prop({ type: String, required: true })
  studentNameLo: string;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GradeLevel', required: true })
  gradeLevelId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  enrolledAt: Date;

  @Prop({ type: String, required: true, enum: ENROLLMENT_STATUSES, default: 'active' })
  status: EnrollmentStatus;

  /** Roll number within the classroom, assigned on enroll. */
  @Prop({ type: Number, default: null })
  rollNumber?: number | null;

  // ── Status-change trail ───────────────────────────────────────────────────

  @Prop({ type: Date, default: null })
  statusChangedAt?: Date | null;

  @Prop({ type: String, default: null })
  statusReason?: string | null;

  /** Set when `status` is `transferred` and the student moved within the school. */
  @Prop({ type: Types.ObjectId, ref: 'Classroom', default: null })
  transferredToClassroomId?: Types.ObjectId | null;
}

export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);

/**
 * One **active** enrollment per student per year.
 *
 * Scoped to `status: 'active'` rather than to all live rows, because a transfer
 * legitimately leaves two rows for the same student and year: the origin marked
 * `transferred` and the destination `active`. A constraint over every non-deleted
 * row would reject the transfer and destroy the placement history.
 */
EnrollmentSchema.index(
  { studentId: 1, schoolYearId: 1 },
  { unique: true, partialFilterExpression: { status: 'active', deletedAt: null } },
);
EnrollmentSchema.index({ classroomId: 1, status: 1 });
EnrollmentSchema.index({ schoolYearId: 1, status: 1 });
EnrollmentSchema.index({ classroomId: 1, rollNumber: 1 });
