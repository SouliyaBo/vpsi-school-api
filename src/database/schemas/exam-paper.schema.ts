import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { EXAM_OPTION_LABEL_STYLES, ExamOptionLabelStyle } from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * A picture the teacher pasted into the Word file — a diagram in a stem, a
 * figure in an option.
 *
 * Only the object key is kept; the bytes live in the bucket under the paper's
 * own prefix and are read back when a set is printed. The size is the one Word
 * recorded, in points, so the picture prints at the size the teacher chose
 * rather than at the pixel size of the file, which for a phone photograph would
 * be a page and a half.
 */
@Schema({ _id: false })
export class ExamImage {
  @Prop({ type: String, required: true })
  key: string;

  @Prop({ type: String, required: true })
  mimeType: string;

  @Prop({ type: Number, required: true, min: 1 })
  widthPt: number;

  @Prop({ type: Number, required: true, min: 1 })
  heightPt: number;

  /** Points the picture's bottom sits below the text baseline (an equation is lowered). */
  @Prop({ type: Number, default: 0 })
  descentPt: number;
}

export const ExamImageSchema = SchemaFactory.createForClass(ExamImage);

/**
 * One answer. The letter is not stored: it is the option's *position* in the
 * printed set, and the whole point of the module is that the position moves.
 */
@Schema({ _id: false })
export class ExamOption {
  /** May be empty: an option can be a picture alone. */
  @Prop({ type: String, default: '' })
  text: string;

  @Prop({ type: [ExamImageSchema], default: [] })
  images: ExamImage[];
}

export const ExamOptionSchema = SchemaFactory.createForClass(ExamOption);

/**
 * One question as the teacher wrote it, before any shuffling.
 *
 * `key` is a random id, not the printed number: the number is a position and
 * differs from set to set. The key is what the review page edits against and
 * what an answer key's "ຂໍ້ 5 ຂອງຊຸດ B" is traced back through.
 */
@Schema({ _id: false })
export class ExamQuestion {
  @Prop({ type: String, required: true })
  key: string;

  /**
   * ພາກ — the heading this question sits under, `null` for a paper with no
   * parts. Shuffling never moves a question out of its part: a paper that puts
   * ten easy questions before ten hard ones stays that way in every set.
   */
  @Prop({ type: String, default: null })
  section?: string | null;

  /** May be empty: a question can be a picture alone, or one the teacher has not typed yet. */
  @Prop({ type: String, default: '' })
  text: string;

  @Prop({ type: [ExamImageSchema], default: [] })
  images: ExamImage[];

  @Prop({ type: [ExamOptionSchema], default: [] })
  options: ExamOption[];

  /**
   * Index into `options` of the right answer, as the teacher's file marked it
   * in bold. `null` when the file marked none or more than one — the review
   * page asks for it, because a set cannot have an answer key otherwise.
   */
  @Prop({ type: Number, default: null, min: 0 })
  correctIndex?: number | null;

  /**
   * Keep the options in the teacher's order in every set.
   *
   * Needed for options that refer to the others by letter — ຖືກທຸກຂໍ້, ທັງ A
   * ແລະ B — which become wrong the moment A and B are somewhere else. Set by
   * the parser when it recognises such wording, and by the teacher otherwise.
   */
  @Prop({ type: Boolean, default: false })
  lockOptions: boolean;
}

export const ExamQuestionSchema = SchemaFactory.createForClass(ExamQuestion);

/**
 * One printed set: which original question stands at each position, and, per
 * position, which original option stands at each letter.
 *
 * Stored as index permutations rather than as copies of the questions so a
 * correction to a stem after the sets were made is a correction to every set,
 * and so the answer key is derivable rather than a second thing to keep right.
 */
@Schema({ _id: false })
export class ExamVariant {
  /** `A`, `B`, `C` … — printed in the corner of every page of the set. */
  @Prop({ type: String, required: true })
  label: string;

  /** `questionOrder[printedPosition] = index into ExamPaper.questions`. */
  @Prop({ type: [Number], required: true })
  questionOrder: number[];

  /**
   * `optionOrders[printedPosition][printedLetter] = index into that question's
   * options`. Identity for a locked question, or when options are not shuffled.
   */
  @Prop({ type: [[Number]], required: true })
  optionOrders: number[][];
}

export const ExamVariantSchema = SchemaFactory.createForClass(ExamVariant);

export type ExamPaperDocument = HydratedDocument<ExamPaper>;

/**
 * ບົດສອບປາລະໄນ — a multiple-choice paper, uploaded as the teacher's Word file,
 * taken apart into questions, and printed back out as several sets with the
 * questions (and their options) in a different order in each.
 *
 * The paper belongs to whoever uploaded it. A teacher sees their own papers and
 * nobody else's — an unprinted exam is the most sensitive document a teacher
 * holds — and the academic office, with `manage`, sees the school's.
 */
@Schema({ collection: 'examPapers', ...baseSchemaOptions })
export class ExamPaper extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  createdById: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', default: null, index: true })
  subjectId?: Types.ObjectId | null;

  /** The class the paper is for; also what the seat plan defaults to. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', default: null, index: true })
  classroomId?: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', default: null, index: true })
  semesterId?: Types.ObjectId | null;

  /** The Word file as uploaded, kept so the teacher can get it back. */
  @Prop({
    type: {
      key: { type: String, required: true },
      filename: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
    },
    default: null,
    _id: false,
  })
  source?: { key: string; filename: string; sizeBytes: number } | null;

  /**
   * Everything the file said before its first question — the school line,
   * the paper's own title, the ຊື່/ຫ້ອງ line, the instructions. Printed at the
   * head of every set exactly as written, because it is the teacher's header
   * and the module has no business rewriting it.
   */
  @Prop({ type: String, default: '' })
  preamble: string;

  @Prop({ type: [ExamQuestionSchema], default: [] })
  questions: ExamQuestion[];

  /** `A. B. C.` or `ກ. ຂ. ຄ.` — whichever the teacher's file used. */
  @Prop({ type: String, enum: EXAM_OPTION_LABEL_STYLES, default: 'latin' })
  optionLabelStyle: ExamOptionLabelStyle;

  /**
   * What the parser could not make sense of — a code and the question it is
   * about, worded by the client in the reader's language.
   *
   * Kept on the record rather than returned once from the upload so the review
   * page can still show them after a reload — a question whose bold answer was
   * not found is a question that will print without one.
   */
  @Prop({
    type: [
      {
        code: { type: String, required: true },
        question: { type: Number, default: null },
        detail: { type: String, default: null },
        _id: false,
      },
    ],
    default: [],
  })
  warnings: { code: string; question: number | null; detail?: string | null }[];

  /** Kept alongside the list so the index page need not load every question. */
  @Prop({ type: Number, default: 0, min: 0 })
  questionCount: number;

  // ── Sets ──────────────────────────────────────────────────────────────────

  @Prop({ type: Number, default: 4, min: 1, max: 8 })
  variantCount: number;

  @Prop({ type: Boolean, default: true })
  shuffleOptions: boolean;

  /**
   * The seed the sets were drawn from. Kept so a paper edited after its sets
   * were made can be re-drawn to the *same* sets — a teacher who fixes a typo
   * an hour before the exam must not find that set B has become a different B.
   */
  @Prop({ type: Number, default: null })
  seed?: number | null;

  @Prop({ type: [ExamVariantSchema], default: [] })
  variants: ExamVariant[];

  @Prop({ type: Date, default: null })
  generatedAt?: Date | null;

  // ── Marking ───────────────────────────────────────────────────────────────

  /**
   * What the paper is out of. Every question is worth the same share of it;
   * a pupil's points are `correct / questions × totalPoints`.
   *
   * Defaults to 6 because that is the ກວດກາ column of the monthly sheet — the
   * school's monthly test is worth six of the month's ten, and the points go
   * straight into that column. `null` marks a sheet in correct answers only.
   */
  @Prop({ type: Number, default: 6, min: 0 })
  totalPoints?: number | null;
}

export const ExamPaperSchema = SchemaFactory.createForClass(ExamPaper);

/** "My papers", newest first. */
ExamPaperSchema.index({ createdById: 1, createdAt: -1 });
