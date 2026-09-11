import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ATTENDANCE_STATUSES,
  AttendanceStatus,
  CONDUCT_GRADES,
  CONDUCT_PERIOD_TYPES,
  CONDUCT_SCORE_SOURCES,
  ConductGrade,
  ConductPeriodType,
  ConductScoreSource,
  GRADES,
  Grade,
  SCORE_COMPONENT_TYPES,
  ScoreComponentType,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

// ── Score component ─────────────────────────────────────────────────────────

export type ScoreComponentDocument = HydratedDocument<ScoreComponent>;

/**
 * A gradeable item within one subject for one semester ("midterm", "homework 1").
 *
 * The weights of all components in a subject+semester must sum to 100; that is
 * enforced in ScoreComponentsService because it is a cross-document invariant.
 */
@Schema({ collection: 'scoreComponents', ...baseSchemaOptions })
export class ScoreComponent extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  /**
   * Scoping a component to one classroom lets two teachers of the same subject
   * run different assessments. `null` = applies to every class taking the subject.
   */
  @Prop({ type: Types.ObjectId, ref: 'Classroom', default: null })
  classroomId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  @Prop({ type: String, required: true, enum: SCORE_COMPONENT_TYPES })
  type: ScoreComponentType;

  /** Percentage of the subject's final mark. All components must total 100. */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  weight: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxScore: number;

  @Prop({ type: Number, default: 0 })
  displayOrder: number;

  @Prop({ type: Date, default: null })
  dueDate?: Date | null;

  /** Blocks all score writes for this component once the teacher submits. */
  @Prop({ type: Boolean, default: false })
  isLocked: boolean;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lockedBy?: Types.ObjectId | null;
}

export const ScoreComponentSchema = SchemaFactory.createForClass(ScoreComponent);
ScoreComponentSchema.index(
  { subjectId: 1, semesterId: 1, classroomId: 1, nameLo: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
ScoreComponentSchema.index({ semesterId: 1, subjectId: 1, displayOrder: 1 });

// ── Score ───────────────────────────────────────────────────────────────────

export type ScoreDocument = HydratedDocument<Score>;

/**
 * One student's mark for one component.
 *
 * `schoolYearId` / `semesterId` / `classroomId` / `subjectId` are denormalized so
 * the term-result aggregation runs without a single `$lookup`. They are immutable
 * after creation: a score belongs to the class the student was in when it was
 * earned, even if the student later transfers. See docs/schema-design.md §3.3.
 */
@Schema({ collection: 'scores', ...baseSchemaOptions })
export class Score extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ScoreComponent', required: true, index: true })
  componentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true })
  subjectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true })
  classroomId: Types.ObjectId;

  /** `null` means "not yet graded", which is distinct from a score of 0. */
  @Prop({ type: Number, default: null, min: 0 })
  score?: number | null;

  /** Copied from the component so a later change to `maxScore` cannot rewrite history. */
  @Prop({ type: Number, required: true, min: 0 })
  maxScore: number;

  @Prop({ type: Boolean, default: false })
  isAbsent: boolean;

  @Prop({ type: String, default: null })
  remark?: string | null;

  // ── Lock trail ────────────────────────────────────────────────────────────

  @Prop({ type: Boolean, default: false, index: true })
  isLocked: boolean;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lockedBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;

  /** Increments on every post-lock amendment; each one also writes an audit log. */
  @Prop({ type: Number, default: 0 })
  revisionCount: number;
}

export const ScoreSchema = SchemaFactory.createForClass(Score);
ScoreSchema.index(
  { studentId: 1, componentId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// The teacher's grade-entry screen: every score for one class+subject+semester.
ScoreSchema.index({ classroomId: 1, subjectId: 1, semesterId: 1 });
// The term-result aggregation and the student's own score view.
ScoreSchema.index({ studentId: 1, semesterId: 1 });

// ── Conduct score ───────────────────────────────────────────────────────────

export type ConductScoreDocument = HydratedDocument<ConductScore>;

@Schema({ collection: 'conductScores', ...baseSchemaOptions })
export class ConductScore extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: CONDUCT_PERIOD_TYPES })
  periodType: ConductPeriodType;

  /**
   * Disambiguates repeats of the same period type: month number 1–12 for
   * `monthly`, otherwise the semester or year number.
   */
  @Prop({ type: Number, required: true })
  periodValue: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  score: number;

  @Prop({ type: String, required: true, enum: CONDUCT_GRADES })
  grade: ConductGrade;

  @Prop({ type: String, default: null })
  remark?: string | null;

  /**
   * `deductions` when this row was computed from the deduction ledger, `manual`
   * when someone typed it in.
   *
   * The ledger only ever overwrites its own rows: a mark the office set by hand
   * is a decision, and the next 5-point deduction must not silently reverse it.
   * Defaults to `manual` so every row written before the ledger existed keeps
   * the protection.
   */
  @Prop({ type: String, required: true, enum: CONDUCT_SCORE_SOURCES, default: 'manual' })
  source: ConductScoreSource;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;
}

export const ConductScoreSchema = SchemaFactory.createForClass(ConductScore);
ConductScoreSchema.index(
  { studentId: 1, semesterId: 1, periodType: 1, periodValue: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
ConductScoreSchema.index({ classroomId: 1, semesterId: 1, periodType: 1 });

// ── Attendance ──────────────────────────────────────────────────────────────

export type AttendanceDocument = HydratedDocument<Attendance>;

/**
 * The fastest-growing collection in the system (students × days × periods),
 * so it stays lean: no embedded objects, and every field is needed by a query.
 *
 * Every record belongs to a taught lesson, never to a bare day: attendance is
 * taken by the teacher of a specific subject in a specific period. The lesson is
 * identified by `teachingAssignmentId`, and `classroomId` / `semesterId` /
 * `subjectId` / `teacherId` / `period` are all copied from it at write time
 * rather than accepted from the client — the client cannot describe a lesson
 * that does not exist on the timetable.
 */
@Schema({ collection: 'attendances', ...baseSchemaOptions })
export class Attendance extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  /** The timetabled lesson this roll call belongs to. */
  @Prop({ type: Types.ObjectId, ref: 'TeachingAssignment', required: true, index: true })
  teachingAssignmentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** Normalized to UTC midnight so a day is one exact value, never a range. */
  @Prop({ type: Date, required: true })
  date: Date;

  /**
   * Period number in the daily timetable, copied from the assignment's schedule.
   * Denormalized so the log can sort chronologically within a day without
   * joining the timetable on every row.
   */
  @Prop({ type: Number, required: true, min: 1 })
  period: number;

  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  /**
   * The teacher who owns the lesson per the timetable.
   *
   * Distinct from `recordedBy`, which is whoever pressed the button — an office
   * user may record on a teacher's behalf, and "whose lesson was this" must
   * still answer the teacher, not the clerk.
   */
  @Prop({ type: Types.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ATTENDANCE_STATUSES })
  status: AttendanceStatus;

  /** Minutes late; only meaningful when `status` is `late`. */
  @Prop({ type: Number, default: null, min: 0 })
  minutesLate?: number | null;

  @Prop({ type: String, default: null })
  reason?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);
// One record per student per lesson. Keyed on the assignment rather than the
// period so that a school teaching the same subject twice in one day keeps both
// roll calls, and so adding a second daily period later needs no migration.
AttendanceSchema.index(
  { studentId: 1, date: 1, teachingAssignmentId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// Daily roll call for a class.
AttendanceSchema.index({ classroomId: 1, date: 1 });
// The roll-call sheet for one lesson on one day.
AttendanceSchema.index({ teachingAssignmentId: 1, date: 1 });
// Absence statistics per student across a term, overall and per subject.
AttendanceSchema.index({ studentId: 1, semesterId: 1, status: 1 });
AttendanceSchema.index({ studentId: 1, semesterId: 1, subjectId: 1 });

// ── Behavior log ────────────────────────────────────────────────────────────

export type BehaviorLogDocument = HydratedDocument<BehaviorLog>;

/**
 * One line of the homeroom behaviour register (ບັນທຶກພຶດຕິກຳຂອງນັກຮຽນ).
 *
 * The paper form is a monthly sheet per class whose row mixes two levels: a note
 * about the class as a whole, and named students with what each of them did. It
 * is stored one record per student so that "this student's history" is an index
 * lookup rather than a scan through embedded arrays — the question the register
 * is actually consulted for.
 *
 * `studentId` is therefore nullable: the paper has rows carrying only the
 * class-level note ("the class studies well, but a few are still noisy") with no
 * name against them, and losing those would lose most of what a homeroom teacher
 * writes down.
 *
 * Like Attendance, every record hangs off a timetabled lesson, and
 * classroom/semester/subject/teacher/period are copied from the assignment at
 * write time rather than taken from the client.
 */
@Schema({ collection: 'behaviorLogs', ...baseSchemaOptions })
export class BehaviorLog extends SoftDeletableDocument {
  /**
   * The sheet row this record was filed as part of.
   *
   * Normalizing to one record per student loses the row, and the row is the unit
   * the teacher edits and deletes — correcting "these four were noisy" must not
   * mean four separate edits, and the printed sheet has to put those four names
   * back on one line. The group id is what survives normalization to say which
   * records were written together.
   */
  @Prop({ type: Types.ObjectId, required: true, index: true })
  groupId: Types.ObjectId;

  /** `null` for a row that only records the state of the class. */
  @Prop({ type: Types.ObjectId, ref: 'Student', default: null, index: true })
  studentId?: Types.ObjectId | null;

  /** The timetabled lesson this observation was made in. */
  @Prop({ type: Types.ObjectId, ref: 'TeachingAssignment', required: true, index: true })
  teachingAssignmentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** Normalized to UTC midnight so a day is one exact value, never a range. */
  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Number, required: true, min: 1 })
  period: number;

  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  /** The teacher who owns the lesson per the timetable, not whoever filed it. */
  @Prop({ type: Types.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  /**
   * ສະພາບລວມພາຍໃນຫ້ອງ — the class as a whole.
   *
   * Repeated on every record of a group rather than split into a parent
   * document: it is written once per row and read on every row, and a second
   * collection to hold one string would make the sheet a join.
   */
  @Prop({ type: String, default: null, trim: true })
  classNote?: string | null;

  /** ພຶດຕິກຳ(ລາຍບຸກຄົນ) — what this student did. */
  @Prop({ type: String, default: null, trim: true })
  behavior?: string | null;

  /**
   * ຕັດຄະແນນ/ຕັກເຕືອນ — free text, exactly as written on the paper form
   * ("ເຕືອນ", "ເຕືອນ 2 ຄັ້ງ", "0").
   *
   * Deliberately unstructured: the register is a diary, and forcing an enum on it
   * would either lose what the teacher meant or stall the entry while they pick a
   * category. Any scoring lives in `conductScores`, which is the structured
   * record of the same term.
   */
  @Prop({ type: String, default: null, trim: true })
  action?: string | null;

  /** ໝາຍເຫດ. */
  @Prop({ type: String, default: null, trim: true })
  remark?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;
}

export const BehaviorLogSchema = SchemaFactory.createForClass(BehaviorLog);
// One entry per student within a row, so a name listed twice by accident is
// rejected rather than silently double-counted in the student's history.
BehaviorLogSchema.index(
  { groupId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// The monthly sheet for a class.
BehaviorLogSchema.index({ classroomId: 1, date: 1 });
// A student's behaviour history, newest first — the register's other read.
BehaviorLogSchema.index({ studentId: 1, date: -1 });
BehaviorLogSchema.index({ studentId: 1, semesterId: 1 });

// ── Term result ─────────────────────────────────────────────────────────────

/** One component's contribution inside a subject result. */
@Schema({ _id: false })
export class TermResultComponent {
  /**
   * The component this line came from, or `null` for a line of the monthly mark
   * sheet — ກັນຍາ and ສອບເສັງພາກ are columns on a form, not records anyone keeps.
   */
  @Prop({ type: Types.ObjectId, ref: 'ScoreComponent', default: null })
  componentId?: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  nameLo: string;

  @Prop({ type: Number, default: null })
  score?: number | null;

  @Prop({ type: Number, required: true })
  maxScore: number;

  @Prop({ type: Number, required: true })
  weight: number;

  /** `score / maxScore * weight` — the component's points out of 100. */
  @Prop({ type: Number, required: true })
  weightedScore: number;
}

export const TermResultComponentSchema = SchemaFactory.createForClass(TermResultComponent);

/** One subject's outcome, embedded because it is only ever read with its term result. */
@Schema({ _id: false })
export class TermResultSubject {
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true })
  subjectId: Types.ObjectId;

  @Prop({ type: String, required: true }) // denormalized from Subject
  subjectNameLo: string;

  @Prop({ type: Number, required: true })
  credits: number;

  @Prop({ type: [TermResultComponentSchema], default: [] })
  components: TermResultComponent[];

  /** Sum of `weightedScore`, i.e. the subject mark out of 100. */
  @Prop({ type: Number, required: true })
  percentage: number;

  @Prop({ type: String, required: true, enum: GRADES })
  grade: Grade;

  @Prop({ type: Number, required: true })
  gradePoint: number;

  @Prop({ type: Boolean, required: true })
  isPassed: boolean;

  /** True when some component had no score — the mark is provisional. */
  @Prop({ type: Boolean, default: false })
  isIncomplete: boolean;
}

export const TermResultSubjectSchema = SchemaFactory.createForClass(TermResultSubject);

export type TermResultDocument = HydratedDocument<TermResult>;

@Schema({ collection: 'termResults', ...baseSchemaOptions })
export class TermResult extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: String, required: true }) // denormalized from Student
  studentCode: string;

  @Prop({ type: String, required: true }) // denormalized from Student
  studentNameLo: string;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: [TermResultSubjectSchema], default: [] })
  subjects: TermResultSubject[];

  /**
   * Mean of the subject percentages, every subject counting once.
   *
   * Divided by `subjectsExpected` — the number of subjects the grade sits — not
   * by how many happen to be marked, which is the school's own rule.
   */
  @Prop({ type: Number, required: true, default: 0 })
  average: number;

  @Prop({ type: Number, required: true, default: 0 })
  gpa: number;

  @Prop({ type: String, required: true, enum: GRADES, default: 'F' })
  grade: Grade;

  /** Position within the classroom; ties share a rank (1,2,2,4). */
  @Prop({ type: Number, default: null })
  rank?: number | null;

  @Prop({ type: Number, default: null })
  totalStudents?: number | null;

  @Prop({ type: Number, default: 0 })
  subjectsPassed: number;

  @Prop({ type: Number, default: 0 })
  subjectsFailed: number;

  /** How many subjects the grade is marked in — what `average` divided by. */
  @Prop({ type: Number, default: 0 })
  subjectsExpected: number;

  /** How many of them this student actually has a mark in. */
  @Prop({ type: Number, default: 0 })
  subjectsRecorded: number;

  @Prop({ type: String, default: null, enum: [...CONDUCT_GRADES, null] })
  conductGrade?: ConductGrade | null;

  // ── Attendance roll-up, copied in at computation time ─────────────────────

  @Prop({ type: Number, default: 0 })
  daysPresent: number;

  @Prop({ type: Number, default: 0 })
  daysAbsent: number;

  @Prop({ type: Number, default: 0 })
  daysLate: number;

  @Prop({ type: Number, default: 0 })
  daysExcused: number;

  /** True when any subject is incomplete — the result must not be published. */
  @Prop({ type: Boolean, default: false })
  isProvisional: boolean;

  @Prop({ type: Date, default: null })
  computedAt?: Date | null;

  /**
   * Bumped whenever the grading formula changes, so a stored result can be
   * traced back to the rules that produced it.
   */
  @Prop({ type: Number, default: 1 })
  computationVersion: number;

  /** Only published results are visible to students and guardians. */
  @Prop({ type: Boolean, default: false })
  isPublished: boolean;

  @Prop({ type: Date, default: null })
  publishedAt?: Date | null;

  /**
   * A mark this result was computed from has changed since.
   *
   * The result is *derived*, so nothing updates it when a teacher corrects a
   * cell — it simply goes quietly out of date, which is the worse failure of the
   * two. The mark-entry paths raise this flag, computing clears it, and the
   * office is shown which classes it is waiting on.
   */
  @Prop({ type: Boolean, default: false })
  isStale: boolean;

  /** When the first change since the last computation landed. */
  @Prop({ type: Date, default: null })
  staleSince?: Date | null;

  /**
   * The last time publication was withdrawn because a recomputation changed the
   * figures a family had already been shown.
   */
  @Prop({ type: Date, default: null })
  unpublishedAt?: Date | null;
}

export const TermResultSchema = SchemaFactory.createForClass(TermResult);
TermResultSchema.index(
  { studentId: 1, semesterId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// Ranking scan: already sorted, so the rank pass is an index walk.
TermResultSchema.index({ classroomId: 1, semesterId: 1, average: -1 });

// ── Monthly mark (ຄະແນນປະຈຳເດືອນ) ────────────────────────────────────────────

export type MonthlyMarkDocument = HydratedDocument<MonthlyMark>;

/**
 * One student's month on the school's own mark sheet, out of 10.
 *
 * Kept apart from `Score` because it is a different instrument, not a different
 * shape of the same one: `Score` is a mark against a component whose weight the
 * school chooses, while this form is fixed — ຂື້ນຫ້ອງ 1, ປື້ມ 1, ກິດຈະກຳ 2,
 * ກວດກາ 6, every subject, every month — and it is read as a hierarchy (month →
 * three months → term → year) that a flat list of weights cannot express.
 *
 * Every cell is nullable so "not written yet" stays distinguishable from a mark
 * of zero: the first is a gap a teacher still owes, the second is what a student
 * earned. A month with all four blank is not stored at all.
 */
@Schema({ collection: 'monthlyMarks', ...baseSchemaOptions })
export class MonthlyMark extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** Calendar month, 1–12. Which ones a term collects is a school setting. */
  @Prop({ type: Number, required: true, min: 1, max: 12 })
  month: number;

  /**
   * The strand within a subject taught as several — ຟີຊິກ / ເຄມີ / ຊີວະ inside
   * ວິທະຍາສາດທຳມະຊາດ, each scored out of 10 and averaged into the month.
   *
   * `null` for an ordinary subject, which then has exactly one row per month.
   * Held as the name the sheet uses rather than an id: the strands are columns
   * on a form, not records anyone maintains.
   */
  @Prop({ type: String, default: null, trim: true })
  strand?: string | null;

  /** ຂື້ນຫ້ອງ, out of 1. */
  @Prop({ type: Number, default: null, min: 0, max: 1 })
  attendance?: number | null;

  /** ປື້ມ, out of 1. */
  @Prop({ type: Number, default: null, min: 0, max: 1 })
  notebook?: number | null;

  /** ກິດຈະກຳ, out of 2. */
  @Prop({ type: Number, default: null, min: 0, max: 2 })
  activity?: number | null;

  /** ກວດກາ, out of 6. */
  @Prop({ type: Number, default: null, min: 0, max: 6 })
  test?: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;

  /** Submitted for the month; further edits need the lock lifted. */
  @Prop({ type: Boolean, default: false })
  isLocked: boolean;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lockedBy?: Types.ObjectId | null;
}

export const MonthlyMarkSchema = SchemaFactory.createForClass(MonthlyMark);
// One row per student per subject per month — per strand where a subject has
// them. `strand: null` participates in the key, so an ordinary subject cannot
// end up with two rows for the same month.
MonthlyMarkSchema.index(
  { studentId: 1, subjectId: 1, semesterId: 1, month: 1, strand: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// The entry grid and the term sheet both read a class at a time.
MonthlyMarkSchema.index({ classroomId: 1, subjectId: 1, semesterId: 1, month: 1 });

// ── Subject term mark (ສອບເສັງພາກ ແລະ ເພີ່ມ) ─────────────────────────────────

export type SubjectTermMarkDocument = HydratedDocument<SubjectTermMark>;

/**
 * The two figures a term carries beside the months: the semester exam and the
 * bonus.
 *
 * A separate document rather than columns on the monthly row, because they
 * belong to the term as a whole — a single exam sat once, not one per month —
 * and because the exam is often entered by the office after the teacher has
 * closed their months.
 */
@Schema({ collection: 'subjectTermMarks', ...baseSchemaOptions })
export class SubjectTermMark extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** ສອບເສັງພາກ, out of 10. Zero is a mark; `null` is "has not sat it". */
  @Prop({ type: Number, default: null, min: 0, max: 10 })
  examScore?: number | null;

  /** ເພີ່ມ — added to the term mark, which is then capped at 10. */
  @Prop({ type: Number, default: null, min: 0, max: 10 })
  bonus?: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isLocked: boolean;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lockedBy?: Types.ObjectId | null;
}

export const SubjectTermMarkSchema = SchemaFactory.createForClass(SubjectTermMark);
SubjectTermMarkSchema.index(
  { studentId: 1, subjectId: 1, semesterId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
SubjectTermMarkSchema.index({ classroomId: 1, subjectId: 1, semesterId: 1 });
