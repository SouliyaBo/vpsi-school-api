import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  GUARDIAN_CONTACT_CHANNELS,
  GuardianContactChannel,
  HOMEROOM_ANOMALY_KINDS,
  HOMEROOM_ANOMALY_SCOPES,
  HOMEROOM_REVIEW_ACTIONS,
  HomeroomAnomalyKind,
  HomeroomAnomalyScope,
  HomeroomReviewAction,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * Why a child was on the sheet, as the sheet said it at the time.
 *
 * A snapshot rather than a reference: the thresholds live in settings and the
 * counts behind them keep moving, so a reason recomputed later would no longer
 * be the reason the teacher acted on. "ຂາດ 3 ວັນ ໃນ 2 ວັນທີ່ຜ່ານມາ" has to keep
 * saying 3 even after the child has been absent twice more.
 */
@Schema({ _id: false })
export class HomeroomAnomalyReason {
  @Prop({ type: String, required: true, enum: HOMEROOM_ANOMALY_KINDS })
  kind: HomeroomAnomalyKind;

  /** Raised by the days since the last review, or by the term to date. */
  @Prop({ type: String, required: true, enum: HOMEROOM_ANOMALY_SCOPES })
  scope: HomeroomAnomalyScope;

  /** What the child's number was — days absent, lates, entries, points left. */
  @Prop({ type: Number, required: true })
  value: number;

  /** The line it crossed, so the row still reads as a judgement and not a figure. */
  @Prop({ type: Number, required: true })
  threshold: number;
}

export const HomeroomAnomalyReasonSchema = SchemaFactory.createForClass(HomeroomAnomalyReason);

/**
 * One child the homeroom teacher looked at, and what they did.
 *
 * Embedded because a line has no life outside the review it was written on. It
 * is the part of this record that is worth anything six months later: the office
 * chases the review, but a guardian meeting is held over "you were told on
 * 25 September, by telephone".
 */
@Schema({ _id: false })
export class HomeroomReviewStudent {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Student', required: true })
  studentId: Types.ObjectId;

  /**
   * The roster copy of the code and name, as every other sheet in the system
   * carries it — a review is read back long after a child may have left.
   */
  @Prop({ type: String, default: null, trim: true })
  studentCode?: string | null;

  @Prop({ type: String, default: null, trim: true })
  studentNameLo?: string | null;

  @Prop({ type: [HomeroomAnomalyReasonSchema], default: [] })
  reasons: HomeroomAnomalyReason[];

  /**
   * What the teacher did. `none` is a real answer — see `HOMEROOM_REVIEW_ACTIONS`.
   */
  @Prop({ type: String, required: true, enum: HOMEROOM_REVIEW_ACTIONS, default: 'none' })
  action: HomeroomReviewAction;

  /** How the guardian was reached; `null` for every action that reached nobody. */
  @Prop({ type: String, default: null, enum: [...GUARDIAN_CONTACT_CHANNELS, null] })
  contactChannel?: GuardianContactChannel | null;

  /** What was said, in the teacher's own words. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;
}

export const HomeroomReviewStudentSchema = SchemaFactory.createForClass(HomeroomReviewStudent);

export type HomeroomReviewDocument = HydratedDocument<HomeroomReview>;

/**
 * ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ — the homeroom teacher's twice-weekly review.
 *
 * One document is one act: on a given ວັນພຸດ or ວັນສຸກ, the homeroom teacher of
 * one room looked at their class's attendance and behaviour, and said what they
 * found. The school already gives that instruction on paper and the system
 * already sends the reminder; what was missing is anything written back, so the
 * office could not tell a teacher who checks every week from one who has not
 * opened the room since August.
 *
 * Only the act is stored. The anomalies themselves are derived on read from the
 * roll call, the register and the discipline ledger — storing them would be a
 * fourth copy of numbers that keep moving — with the exception of the reasons
 * snapshotted onto `students[]`, which are the ones the teacher actually acted
 * on and so must stop moving.
 *
 * `dueDate` rather than "when it was filed" is what makes the record answerable:
 * a review is owed *for* Wednesday, and one written on Thursday morning is
 * Wednesday's review filed late — not Thursday's. The lateness itself is derived
 * on read against the school calendar, like every other deadline in the system.
 */
@Schema({ collection: 'homeroomReviews', ...baseSchemaOptions })
export class HomeroomReview extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  /**
   * ຄູປະຈຳຫ້ອງ — the homeroom teacher the review is credited to.
   *
   * Copied from the room at the moment of writing rather than resolved on read:
   * a room that changes homeroom teacher in January must not move last term's
   * reviews onto the new teacher's record, in either direction.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  /** The account that filed it — normally the teacher's own, sometimes the office's. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  recordedById?: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  /** The ວັນພຸດ/ວັນສຸກ this review answers for, at UTC midnight. */
  @Prop({ type: Date, required: true, index: true })
  dueDate: Date;

  /**
   * The stretch of days the sheet covered — the day after the previous review
   * through `dueDate`.
   *
   * Stored because it is not derivable afterwards: it depends on which review
   * days the calendar owed at the time and on when the teacher last filed, and
   * a report that said "3 days" about a sheet that covered a week would be
   * quietly wrong.
   */
  @Prop({ type: Date, required: true })
  windowStart: Date;

  @Prop({ type: Date, required: true })
  windowEnd: Date;

  /** How many children were on the roll when the sheet was read. */
  @Prop({ type: Number, required: true, min: 0 })
  studentsOnRoll: number;

  /**
   * How many the system flagged — not how many the teacher listed.
   *
   * Held apart from `students.length` so a review that flagged six children and
   * came back with one line is visible as such.
   */
  @Prop({ type: Number, required: true, min: 0 })
  studentsFlagged: number;

  @Prop({ type: [HomeroomReviewStudentSchema], default: [] })
  students: HomeroomReviewStudent[];

  /** ໝາຍເຫດ — anything about the class as a whole. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;
}

export const HomeroomReviewSchema = SchemaFactory.createForClass(HomeroomReview);

/**
 * One review per room per due day.
 *
 * A second sheet for the same Wednesday is an amendment of the first, not a
 * second review, and without this the compliance report would count a teacher
 * who filed twice as twice as diligent. Partial on `deletedAt` so a withdrawn
 * sheet does not block the room from filing again.
 */
HomeroomReviewSchema.index(
  { classroomId: 1, dueDate: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

/** The compliance report: every room's reviews across a window, newest first. */
HomeroomReviewSchema.index({ semesterId: 1, dueDate: -1 });

/** One teacher's own record, which is what the teacher's screen reads. */
HomeroomReviewSchema.index({ teacherId: 1, dueDate: -1 });
