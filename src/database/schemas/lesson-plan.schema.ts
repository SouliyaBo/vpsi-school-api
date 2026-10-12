import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { LESSON_PLAN_STATUSES, LessonPlanStatus } from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * A taught session recorded against the plan.
 * Embedded: bounded to a term's worth of sessions and never queried alone.
 */
@Schema({ _id: true })
export class LessonActivity {
  @Prop({ type: String, required: true, trim: true })
  topic: string;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Number, default: null })
  durationMinutes?: number | null;

  @Prop({ type: String, default: null })
  objectives?: string | null;

  @Prop({ type: [String], default: [] })
  materials: string[];

  @Prop({ type: String, default: null })
  teachingMethod?: string | null;

  @Prop({ type: Boolean, default: false })
  isCompleted: boolean;

  @Prop({ type: String, default: null })
  reflection?: string | null;
}

export const LessonActivitySchema = SchemaFactory.createForClass(LessonActivity);

/** One approve/return decision. The array is the full review history. */
@Schema({ _id: true })
export class LessonPlanReview {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  reviewerId: Types.ObjectId;

  @Prop({ type: String, required: true }) // denormalized reviewer name
  reviewerName: string;

  @Prop({ type: String, required: true, enum: ['approved', 'returned'] })
  decision: 'approved' | 'returned';

  @Prop({ type: String, default: null })
  comment?: string | null;

  @Prop({ type: Date, required: true })
  reviewedAt: Date;
}

export const LessonPlanReviewSchema = SchemaFactory.createForClass(LessonPlanReview);

/** S3-backed attachment, reused across lesson plans and documents. */
@Schema({ _id: false })
export class Attachment {
  @Prop({ type: String, required: true })
  key: string;

  @Prop({ type: String, required: true })
  filename: string;

  @Prop({ type: String, required: true })
  mimeType: string;

  @Prop({ type: Number, required: true })
  sizeBytes: number;

  @Prop({ type: Date, required: true })
  uploadedAt: Date;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

export type LessonPlanDocument = HydratedDocument<LessonPlan>;

@Schema({ collection: 'lessonPlans', ...baseSchemaOptions })
export class LessonPlan extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true })
  classroomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: null })
  description?: string | null;

  /**
   * Monday of the taught week, at UTC midnight.
   *
   * Snapped to the Monday on write (`startOfWeek`), not stored as the teacher
   * typed it. The compliance matrix matches a plan to a column by exact date, so
   * an unnormalized Tuesday would leave the week looking unplanned.
   */
  @Prop({ type: Date, required: true })
  weekStartDate: Date;

  /** Derived — the Sunday closing `weekStartDate`'s week. */
  @Prop({ type: Date, required: true })
  weekEndDate: Date;

  @Prop({ type: [LessonActivitySchema], default: [] })
  activities: LessonActivity[];

  @Prop({ type: [AttachmentSchema], default: [] })
  attachments: Attachment[];

  @Prop({ type: String, required: true, enum: LESSON_PLAN_STATUSES, default: 'draft' })
  status: LessonPlanStatus;

  /**
   * Derived from `lessonPlans.submissionPolicy` at creation, never sent by the
   * client — a teacher who sets their own deadline is never late.
   */
  @Prop({ type: Date, required: true })
  dueDate: Date;

  @Prop({ type: Date, default: null })
  submittedAt?: Date | null;

  /** Derived at submit time: `submittedAt > dueDate`. */
  @Prop({ type: Boolean, default: false })
  isLate: boolean;

  @Prop({ type: [LessonPlanReviewSchema], default: [] })
  reviews: LessonPlanReview[];

  /** Mirrors the latest review decision so the review queue can filter cheaply. */
  @Prop({ type: Date, default: null })
  lastReviewedAt?: Date | null;
}

export const LessonPlanSchema = SchemaFactory.createForClass(LessonPlan);

/**
 * One plan per lesson per week.
 *
 * Without this, a teacher revising a plan by filing a second one would leave the
 * matrix with two answers for the same cell and no rule for which is the real
 * submission. A returned plan is edited and resubmitted — that is the whole
 * point of the `returned → submitted` transition — so a duplicate is a mistake,
 * not a use case.
 */
LessonPlanSchema.index(
  { teacherId: 1, subjectId: 1, classroomId: 1, semesterId: 1, weekStartDate: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
LessonPlanSchema.index({ teacherId: 1, semesterId: 1, status: 1 });
LessonPlanSchema.index({ status: 1, dueDate: 1 });
LessonPlanSchema.index({ classroomId: 1, semesterId: 1 });
// Drives the compliance matrix: one semester's plans, read whole.
LessonPlanSchema.index({ semesterId: 1, weekStartDate: 1 });

// ── The monthly checklist ───────────────────────────────────────────────────

export type LessonPlanMonthDocument = HydratedDocument<LessonPlanMonth>;

/**
 * A month of lesson-plan obligations, as issued by the academic office.
 *
 * The compliance matrix already derives who owes a plan for every week of the
 * term, and that derivation cannot be argued with — which is exactly its limit.
 * A term contains exam weeks, public holidays and the week a teacher was away,
 * and a matrix that counts those as shortfalls is a report nobody trusts. This
 * collection is the office's answer to "what is actually due this month": drafted
 * from the timetable, trimmed by hand, and then published — after which teachers
 * see it and the count means something.
 */
@Schema({ collection: 'lessonPlanMonths', ...baseSchemaOptions })
export class LessonPlanMonth extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  /** Calendar year and month (1–12) — not a term week number. */
  @Prop({ type: Number, required: true })
  year: number;

  @Prop({ type: Number, required: true, min: 1, max: 12 })
  month: number;

  /**
   * `draft` is the office's working copy: invisible to teachers, and safe to
   * regenerate from the timetable. Publishing is the moment it becomes an
   * obligation, so it is one-way.
   */
  @Prop({ type: String, required: true, enum: ['draft', 'published'], default: 'draft' })
  status: 'draft' | 'published';

  @Prop({ type: Date, default: null })
  publishedAt?: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  publishedBy?: Types.ObjectId | null;

  /** Instruction from the academic head, shown to every teacher on the list. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;
}

export const LessonPlanMonthSchema = SchemaFactory.createForClass(LessonPlanMonth);

/** One checklist per month per semester — a second would split the count. */
LessonPlanMonthSchema.index(
  { semesterId: 1, year: 1, month: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

export type LessonPlanTaskDocument = HydratedDocument<LessonPlanTask>;

/**
 * One line of a monthly checklist: this teacher, this lesson, this week.
 *
 * Deliberately carries no status of its own. The teacher's submission lives on
 * the `LessonPlan` this points at, and duplicating "has it been handed in" here
 * would create two answers that drift the first time a plan is returned. The
 * line is the obligation; the plan is the answer to it.
 */
@Schema({ collection: 'lessonPlanTasks', ...baseSchemaOptions })
export class LessonPlanTask extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'LessonPlanMonth', required: true, index: true })
  monthId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  /**
   * The timetable row this obligation comes from.
   *
   * Kept so a line can be traced back after the fact — and so regenerating a
   * draft recognises the lines it already produced rather than duplicating them.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'TeachingAssignment', required: true })
  teachingAssignmentId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true })
  subjectId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true })
  classroomId: Types.ObjectId;

  /** Monday at UTC midnight — the same key a plan is filed under. */
  @Prop({ type: Date, required: true })
  weekStartDate: Date;

  @Prop({ type: Date, required: true })
  weekEndDate: Date;

  /** The week's number within the semester, as the school counts them. */
  @Prop({ type: Number, required: true })
  weekIndex: number;

  /**
   * Derived from school policy when the line is drafted, then editable per line —
   * an exam week's plan may be wanted earlier than the standing rule.
   */
  @Prop({ type: Date, required: true })
  dueDate: Date;

  /** Set the first time the teacher uploads against this line. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'LessonPlan', default: null })
  lessonPlanId?: Types.ObjectId | null;
}

export const LessonPlanTaskSchema = SchemaFactory.createForClass(LessonPlanTask);

/** One line per lesson per week in a given month. */
LessonPlanTaskSchema.index(
  { monthId: 1, teachingAssignmentId: 1, weekStartDate: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
/** A teacher opening their checklist reads exactly this. */
LessonPlanTaskSchema.index({ teacherId: 1, monthId: 1, weekStartDate: 1 });
