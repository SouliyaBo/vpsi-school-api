import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
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
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  /** denormalized from Student — immutable, lets class rosters render without a lookup */
  @Prop({ type: String, required: true })
  studentCode: string;

  /** denormalized from Student */
  @Prop({ type: String, required: true })
  studentNameLo: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'GradeLevel', required: true })
  gradeLevelId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  enrolledAt: Date;

  @Prop({ type: String, required: true, enum: ENROLLMENT_STATUSES, default: 'active' })
  status: EnrollmentStatus;

  /** Roll number within the classroom, assigned on enroll. */
  @Prop({ type: Number, default: null })
  rollNumber?: number | null;

  /**
   * `ຫ້ອງພາກອັງກິດ` — the English-programme room, which is not the homeroom.
   *
   * The English lessons regroup the year into their own rooms, so a child in
   * `ມ.1/ກ` sits in `EP-A` for English and the two lists have no relation the
   * system could derive. Held as the office writes it rather than as a
   * `Classroom` ref: these rooms have no register, no roll numbers and no
   * capacity — only a label on the child.
   *
   * Lives here rather than on `Student` because the grouping is re-made every
   * year, so last year's room must stay readable next to last year's homeroom.
   */
  @Prop({ type: String, default: null, trim: true })
  englishClass?: string | null;

  // ── Status-change trail ───────────────────────────────────────────────────

  @Prop({ type: Date, default: null })
  statusChangedAt?: Date | null;

  @Prop({ type: String, default: null })
  statusReason?: string | null;

  /** Set when `status` is `transferred` and the student moved within the school. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', default: null })
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
