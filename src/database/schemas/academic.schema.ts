import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SEMESTER_STATUSES,
  SUBJECT_TYPES,
  SemesterStatus,
  SubjectType,
} from 'src/common/constants/enums';
import { baseSchemaOptions, LAO_COLLATION, SoftDeletableDocument } from './base.schema';

// ── School year ─────────────────────────────────────────────────────────────

export type SchoolYearDocument = HydratedDocument<SchoolYear>;

@Schema({ collection: 'schoolYears', ...baseSchemaOptions })
export class SchoolYear extends SoftDeletableDocument {
  /** e.g. `2025-2026`. */
  @Prop({ type: String, required: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  endDate: Date;

  /**
   * At most one year is active at a time; SchoolYearsService deactivates the
   * previous one in the same transaction that activates a new one.
   */
  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

export const SchoolYearSchema = SchemaFactory.createForClass(SchoolYear);
SchoolYearSchema.index({ code: 1 }, { unique: true });
SchoolYearSchema.index({ isActive: 1 });

// ── Semester ────────────────────────────────────────────────────────────────

export type SemesterDocument = HydratedDocument<Semester>;

@Schema({ collection: 'semesters', ...baseSchemaOptions })
export class Semester extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  /** 1 or 2 within the school year. */
  @Prop({ type: Number, required: true, min: 1, max: 4 })
  number: number;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  endDate: Date;

  /**
   * `grading` allows score entry but blocks enrollment changes;
   * `closed` freezes everything.
   */
  @Prop({ type: String, required: true, enum: SEMESTER_STATUSES, default: 'upcoming' })
  status: SemesterStatus;

  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

export const SemesterSchema = SchemaFactory.createForClass(Semester);
SemesterSchema.index({ schoolYearId: 1, number: 1 }, { unique: true });
SemesterSchema.index({ isActive: 1, status: 1 });

// ── Grade level ─────────────────────────────────────────────────────────────

export type GradeLevelDocument = HydratedDocument<GradeLevel>;

@Schema({ collection: 'gradeLevels', ...baseSchemaOptions })
export class GradeLevel extends SoftDeletableDocument {
  /** e.g. `m1` … `m7`. */
  @Prop({ type: String, required: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  /** Ordering key used when promoting students to the next level. */
  @Prop({ type: Number, required: true })
  level: number;

  /** `true` for m4 and m7 — the levels with national exams. */
  @Prop({ type: Boolean, default: false })
  isExitLevel: boolean;
}

export const GradeLevelSchema = SchemaFactory.createForClass(GradeLevel);
GradeLevelSchema.index({ code: 1 }, { unique: true });
GradeLevelSchema.index({ level: 1 });

// ── Classroom ───────────────────────────────────────────────────────────────

export type ClassroomDocument = HydratedDocument<Classroom>;

@Schema({ collection: 'classrooms', ...baseSchemaOptions })
export class Classroom extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GradeLevel', required: true, index: true })
  gradeLevelId: Types.ObjectId;

  /** Section name within the grade, e.g. `ກ`, `ຂ`, `A`. */
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Teacher', default: null, index: true })
  homeroomTeacherId?: Types.ObjectId | null;

  @Prop({ type: Number, required: true, min: 1, default: 45 })
  capacity: number;

  /**
   * Maintained by EnrollmentsService inside the enrollment transaction so the
   * capacity check does not need a `countDocuments` on every enroll.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  currentCount: number;

  @Prop({ type: String, default: null, trim: true })
  room?: string | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const ClassroomSchema = SchemaFactory.createForClass(Classroom);
ClassroomSchema.index({ schoolYearId: 1, gradeLevelId: 1, name: 1 }, { unique: true });
ClassroomSchema.index({ schoolYearId: 1, isActive: 1 });

// ── Subject group ───────────────────────────────────────────────────────────

export type SubjectGroupDocument = HydratedDocument<SubjectGroup>;

/**
 * A `ສາຍວິຊາ` — the department a subject and a teacher both belong to.
 *
 * It exists because two questions have no other answer. `Subject` is per grade
 * level, so maths is seven rows and grouping lesson-plan compliance by subject
 * splits one department into seven; and `Teacher.isAcademicHead` says someone
 * reviews plans without saying *whose* — so a submission had to notify every
 * head in the school. This collection is what makes "the science department" a
 * thing the system can count and route to.
 */
@Schema({ collection: 'subjectGroups', ...baseSchemaOptions })
export class SubjectGroup extends SoftDeletableDocument {
  /** e.g. `science`, `languages`. */
  @Prop({ type: String, required: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  /**
   * The head who reviews this group's lesson plans.
   *
   * Nullable: a group may be created before the school decides who runs it, and
   * a head who resigns leaves the group standing. Plan submissions fall back to
   * every `isAcademicHead` teacher while it is unset.
   */
  @Prop({ type: Types.ObjectId, ref: 'Teacher', default: null, index: true })
  headTeacherId?: Types.ObjectId | null;

  /** Display order in menus and on the compliance matrix. */
  @Prop({ type: Number, required: true, min: 1, default: 1 })
  sortOrder: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const SubjectGroupSchema = SchemaFactory.createForClass(SubjectGroup);
SubjectGroupSchema.index({ code: 1 }, { unique: true });
SubjectGroupSchema.index({ sortOrder: 1, isActive: 1 });

// ── Subject ─────────────────────────────────────────────────────────────────

export type SubjectDocument = HydratedDocument<Subject>;

@Schema({ collection: 'subjects', ...baseSchemaOptions })
export class Subject extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'GradeLevel', required: true, index: true })
  gradeLevelId: Types.ObjectId;

  /**
   * The department this subject is taught by.
   *
   * Nullable rather than required: the subject rows predate the groups, and a
   * migration that guessed the department from a name would be wrong for the
   * ones the school splits differently. An ungrouped subject shows up under
   * "unassigned" on the compliance matrix, which is a visible prompt to file it.
   */
  @Prop({ type: Types.ObjectId, ref: 'SubjectGroup', default: null, index: true })
  subjectGroupId?: Types.ObjectId | null;

  /**
   * The ສາຍວິຊາ this subject is marked under, when the school splits it.
   *
   * The school runs on **four** ສາຍວິຊາ — ພາສາລາວ-ວັນນະຄະດີ, ຄະນິດສາດ, ສັງຄົມ,
   * ທຳມະຊາດ — and that is what a teacher is assigned to, what roll call is taken
   * against, and what a behaviour note is filed under. From ມ.4 up, the mark
   * sheet splits two of them: ທຳມະຊາດ into ຟີຊິກສາດ / ເຄມີສາດ / ຊີວະສາດ and
   * ສັງຄົມ into ສຶກສາພົນລະເມືອງ / ພູມສາດ / ປະຫວັດສາດ, each with its own exam and
   * its own line on the report card.
   *
   * So a subject is one of two things, and this field is what tells them apart:
   *
   *  - `null` and nothing points at it — an ordinary subject: taught *and*
   *    marked (ພາສາລາວ, ຄະນິດສາດ at every grade; all four at ມ.1–ມ.3).
   *  - `null` but children point at it — a **split parent**: taught, assigned
   *    and registered against, but never marked. Its children carry the marks.
   *  - set — a **marked subject**: it appears on the mark sheet and the report
   *    card, and the teacher who may fill it in is the one assigned to its
   *    parent, because that is who the timetable names.
   *
   * A parent rather than a `strands` list because these are whole subjects: each
   * sits its own ສອບເສັງ and each is passed or failed on its own. `strands` is
   * the weaker case — columns averaged into one subject mark — and is left in
   * place for a school that marks that way.
   */
  @Prop({ type: Types.ObjectId, ref: 'Subject', default: null })
  parentSubjectId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: SUBJECT_TYPES, default: 'core' })
  type: SubjectType;

  /** Weight of this subject when averaging the term result. */
  @Prop({ type: Number, required: true, min: 0, default: 1 })
  credits: number;

  @Prop({ type: Number, default: 0, min: 0 })
  hoursPerWeek: number;

  /**
   * Where the subject sits in the school's own order, low first.
   *
   * The mark sheet is a printed form and its columns run in a fixed order —
   * ພາສາລາວ-ວັນນະຄະດີ, ຄະນິດສາດ, ສຶກສາພົນລະເມືອງ, ຟີຊິກສາດ, ເຄມີສາດ, ຊີວະສາດ,
   * ພູມສາດ, ປະຫວັດສາດ — which is neither alphabetical nor the order the rows
   * happen to be created in. Ties fall back to `code`, so a subject nobody has
   * ordered still lands somewhere stable.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  sortOrder: number;

  /**
   * The strands this subject is marked in, when the monthly sheet splits it.
   *
   * ວິທະຍາສາດທຳມະຊາດ is kept as ຟີຊິກ / ເຄມີ / ຊີວະ, each scored out of 10 and
   * averaged into the month. Empty for an ordinary subject, which is marked once
   * a month. Names rather than ids: they are columns on a form, not records
   * anyone maintains — see `MonthlyMark.strand`.
   */
  @Prop({ type: [String], default: [] })
  strands: string[];

  /** Percentage of `maxScore` required to pass. Falls back to the global setting. */
  @Prop({ type: Number, default: null, min: 0, max: 100 })
  passingPercentage?: number | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.index({ code: 1 }, { unique: true });
SubjectSchema.index({ gradeLevelId: 1, isActive: 1 });
SubjectSchema.index({ parentSubjectId: 1 });
SubjectSchema.index({ nameLo: 1 }, { collation: LAO_COLLATION });
