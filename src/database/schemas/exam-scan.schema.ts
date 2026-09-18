import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

export type ExamScanDocument = HydratedDocument<ExamScan>;

export const EXAM_SCAN_STATUSES = ['pending', 'confirmed', 'failed'] as const;
export type ExamScanStatus = (typeof EXAM_SCAN_STATUSES)[number];

/**
 * One photographed answer sheet and what the reader made of it.
 *
 * Kept apart from the response it may become: a scan is evidence and a
 * proposal, the response is the mark. The teacher looks at the proposal on
 * the photograph, fixes what the reader was unsure of, and confirms — only
 * then is a response written, with `source: 'scan'`. The reader's evidence
 * (each bubble's darkness, and where it looked) stays here so the review
 * page can draw it, and so a disputed mark can be checked later.
 */
@Schema({ collection: 'examScans', ...baseSchemaOptions })
export class ExamScan extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'ExamPaper', required: true, index: true })
  paperId: Types.ObjectId;

  /** The photograph as analysed — upright, resized — in the bucket. */
  @Prop({ type: String, required: true })
  imageKey: string;

  @Prop({ type: String, default: null })
  filename?: string | null;

  @Prop({ type: { width: Number, height: Number, _id: false }, default: null })
  image?: { width: number; height: number } | null;

  @Prop({ type: String, required: true, enum: EXAM_SCAN_STATUSES, default: 'pending', index: true })
  status: ExamScanStatus;

  /** Why the reader gave up, for a `failed` scan. */
  @Prop({ type: String, default: null })
  failure?: string | null;

  // ── Who and which set — the reader's proposal, then the teacher's word ──

  @Prop({ type: Types.ObjectId, ref: 'Student', default: null, index: true })
  studentId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  studentCode?: string | null;

  @Prop({ type: String, default: null })
  studentNameLo?: string | null;

  /** The set — `setLabel` because `set` is a Document method. */
  @Prop({ type: String, default: null })
  setLabel?: string | null;

  /** What the QR said, verbatim. */
  @Prop({
    type: { paperId: String, set: String, studentId: String, _id: false },
    default: null,
  })
  qr?: { paperId: string; set: string | null; studentId: string | null } | null;

  @Prop({ type: String, default: null })
  codeFromBubbles?: string | null;

  @Prop({ type: Number, default: null })
  setFromBubbles?: number | null;

  // ── The answers, with the evidence ──────────────────────────────────────

  /** Per printed question: the reader's (then the teacher's) letter index or null. */
  @Prop({ type: [Number], default: [] })
  answers: (number | null)[];

  /**
   * The reader's evidence per question: its flag, each option's darkness
   * and each bubble's place in the photo. Mixed on purpose — it is drawn,
   * never queried.
   */
  @Prop({ type: [Object], default: [] })
  questions: {
    number: number;
    marked: number | null;
    flag: 'ok' | 'blank' | 'faint' | 'double';
    darkness: number[];
    centres: { x: number; y: number }[];
  }[];

  @Prop({ type: [Object], default: [] })
  corners: { x: number; y: number }[];

  @Prop({ type: Number, default: null })
  contrast?: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedById: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ExamResponse', default: null })
  responseId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;
}

export const ExamScanSchema = SchemaFactory.createForClass(ExamScan);

ExamScanSchema.index({ paperId: 1, status: 1, createdAt: -1 });
