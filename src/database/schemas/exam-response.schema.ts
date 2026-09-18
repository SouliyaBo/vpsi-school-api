import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

export type ExamResponseDocument = HydratedDocument<ExamResponse>;

/**
 * One pupil's answers to one paper — the filled answer sheet, as data.
 *
 * `answers` is indexed by the *printed* position of the set the pupil held,
 * because that is what the sheet shows and what the teacher keys in; the
 * translation back to the teacher's own question order goes through the
 * paper's variant tables at grading time, never by hand. The marks are
 * stored so the class list and its averages are one read; they are recomputed
 * from the stored answers whenever the paper is saved, so a corrected key or
 * a changed total re-marks every sheet the same way.
 */
@Schema({ collection: 'examResponses', ...baseSchemaOptions })
export class ExamResponse extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'ExamPaper', required: true, index: true })
  paperId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  /** Copied from the enrollment when keyed in, as the mark sheets do. */
  @Prop({ type: String, required: true })
  studentCode: string;

  @Prop({ type: String, required: true })
  studentNameLo: string;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', default: null, index: true })
  classroomId?: Types.ObjectId | null;

  /** Which set the pupil sat — `A`, `B` … (`setLabel`: `set` is a Document method). */
  @Prop({ type: String, required: true })
  setLabel: string;

  /**
   * Per printed position, the index of the letter marked (0 = A), or `null`
   * for a blank. A double mark is keyed as a blank: the sheet says so.
   */
  @Prop({ type: [Number], required: true, default: [] })
  answers: (number | null)[];

  @Prop({ type: Number, required: true, default: 0 })
  correctCount: number;

  @Prop({ type: Number, required: true, default: 0 })
  totalQuestions: number;

  /** `correctCount` scaled to the paper's `totalPoints`, two decimals. */
  @Prop({ type: Number, default: null })
  points?: number | null;

  /** `manual` — keyed from the sheet; `scan` is reserved for the reader. */
  @Prop({ type: String, required: true, enum: ['manual', 'scan'], default: 'manual' })
  source: 'manual' | 'scan';

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  recordedById?: Types.ObjectId | null;
}

export const ExamResponseSchema = SchemaFactory.createForClass(ExamResponse);

/** One sheet per pupil per paper. */
ExamResponseSchema.index(
  { paperId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
