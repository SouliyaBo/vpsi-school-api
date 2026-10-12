import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  TEACHING_OBSERVATION_STATUSES,
  TeachingObservationStatus,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * One line of the sheet: a criterion and the mark it was given.
 *
 * Embedded because a line has no life outside the sheet it was written on — it
 * is never queried, corrected or reported on its own, and six of them arrive and
 * leave together.
 *
 * `criterion` is a rubric key rather than the printed Lao label. The wording on
 * the form can be reworded by the office without silently detaching last term's
 * marks from the thing they were marks *of*, and a sheet from 2025 still lines
 * up column-for-column with one from 2026.
 */
@Schema({ _id: false })
export class ObservationScore {
  @Prop({ type: String, required: true })
  criterion: string;

  /**
   * 0–10, or `null` for a line the observer has not marked yet.
   *
   * `null` is not zero, and the difference is the whole reason the field is
   * nullable: zero is a judgement — the teacher did this and it was worthless —
   * while `null` is "the sheet is still open". Submitting refuses any `null`,
   * so the distinction never survives into a filed sheet.
   */
  @Prop({ type: Number, default: null, min: 0, max: 10 })
  score?: number | null;
}

export const ObservationScoreSchema = SchemaFactory.createForClass(ObservationScore);

export type TeachingObservationDocument = HydratedDocument<TeachingObservation>;

/**
 * ຕິດຕາມການສອນຂອງຄູ — the classroom-observation sheet.
 *
 * One document is one visit: a named observer sat in on a named teacher's lesson
 * on a given day, and scored six criteria out of ten each. The paper form the
 * school uses carries the observed teacher, the department, the subject, the
 * room, the date and the visit number — but nowhere does it say *who did the
 * observing*, which makes a filed stack of sheets impossible to hold anyone to.
 * `observerId` is that missing line, and it is required.
 */
@Schema({ collection: 'teachingObservations', ...baseSchemaOptions })
export class TeachingObservation extends SoftDeletableDocument {
  /** ຊື່ຜູ້ຖືກປະເມີນ (ຄູສອນ) — the teacher whose lesson was watched. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  teacherId: Types.ObjectId;

  /**
   * ຜູ້ຕິດຕາມ — the teacher who did the observing.
   *
   * The field the paper form is missing. Stored as a `Teacher` rather than as
   * the `User` who typed it in, because the observer is a person the school can
   * name to the teacher afterwards, and the two are not the same: the academic
   * office routinely keys in a deputy's handwritten sheet. Who typed it is
   * `recordedById`, and it is only ever an audit answer.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', required: true, index: true })
  observerId: Types.ObjectId;

  /** The account that entered the sheet — not necessarily the observer's. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  recordedById?: Types.ObjectId | null;

  /** ວິຊາທີ່ສອນ — the lesson that was watched. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId: Types.ObjectId;

  /**
   * ສາຍວິຊາ — the department, copied from the subject when the sheet is written.
   *
   * Denormalized rather than joined on read: the summary groups a term's visits
   * by department, and a subject that is refiled under a different ສາຍວິຊາ next
   * year must not retroactively move a sheet that was written under the old one.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'SubjectGroup', default: null, index: true })
  subjectGroupId?: Types.ObjectId | null;

  /** ຫ້ອງ */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  /** ວັນທີ — the day of the visit, at UTC midnight. */
  @Prop({ type: Date, required: true })
  observedAt: Date;

  /**
   * ປະເມີນຄັ້ງທີ — which visit this is, for this observer and this subject.
   *
   * Counted per observer per observed teacher per subject within the semester,
   * and derived when the client leaves it out. The scope is what the number
   * means on the paper form: the observer writes ຄັ້ງທີ 1 on the first sheet
   * *they* fill in about that teacher's subject, and a second observer sitting
   * in writes ຄັ້ງທີ 1 on theirs. Counting per teacher alone made the deputy's
   * first visit ຄັ້ງທີ 3 because two colleagues had been in that term — a
   * number nobody could reconcile with the sheet in their hand.
   *
   * The classroom is deliberately *not* in the scope: watching the same teacher
   * teach the same subject to ມ.3/ກ and then to ມ.3/ຂ is the second visit of
   * that run, not a fresh first one. The office counts visits to a teacher's
   * teaching, not to a room.
   */
  @Prop({ type: Number, required: true, min: 1 })
  visitNumber: number;

  /** Six lines, one per rubric criterion, in the rubric's own order. */
  @Prop({ type: [ObservationScoreSchema], default: [] })
  scores: ObservationScore[];

  /**
   * ລວມຄະແນນປະເມີນ, and what it is out of.
   *
   * Stored rather than derived on read — unlike the mark sheets, where a total
   * is the sum of cells edited independently over three months. Here the six
   * lines and their total are written in one action and can never be updated
   * apart, so there is no window in which the two could disagree; and storing it
   * is what lets the per-teacher summary average and sort in the database rather
   * than by pulling every sheet of the term into memory.
   *
   * `maxScore` counts only the lines that carry a mark, so a draft's percentage
   * is honest about how much of the sheet has been filled in.
   */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  totalScore: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  maxScore: number;

  /** Free text — the paper form has no box for it, and the office asked for one. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;

  @Prop({
    type: String,
    required: true,
    enum: TEACHING_OBSERVATION_STATUSES,
    default: 'draft',
  })
  status: TeachingObservationStatus;

  @Prop({ type: Date, default: null })
  submittedAt?: Date | null;

  /** Set only by the observed teacher — see the status enum. */
  @Prop({ type: Date, default: null })
  acknowledgedAt?: Date | null;
}

export const TeachingObservationSchema = SchemaFactory.createForClass(TeachingObservation);

/**
 * One sheet per visit number, within one observer's run of visits to one subject.
 *
 * Two sheets by the same observer both headed ຄັ້ງທີ 2 about the same teacher
 * and subject would leave the office with two answers to "how did that visit go"
 * and no rule for which is the real one. Two *different* observers each headed
 * ຄັ້ງທີ 1 are not that: they are two people who each sat in once, which is the
 * ordinary case and the reason the observer is in the key.
 *
 * `classroomId` is not in the key: a second room is a second visit in the same
 * run, so it takes the next number rather than starting again at 1.
 *
 * The number is derived on create precisely so this never has to be explained to
 * a user, and the index is what holds when two observers file at the same moment.
 */
TeachingObservationSchema.index(
  { teacherId: 1, observerId: 1, subjectId: 1, semesterId: 1, visitNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
/** The list, and the per-teacher summary behind it. */
TeachingObservationSchema.index({ semesterId: 1, observedAt: -1 });
/** "What have I filed this term" — the observer's own view. */
TeachingObservationSchema.index({ observerId: 1, semesterId: 1, observedAt: -1 });
