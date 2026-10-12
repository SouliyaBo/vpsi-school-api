import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  BOOK_BORROWER_TYPES,
  BOOK_COUNT_CATEGORIES,
  BOOK_TITLE_CATEGORIES,
  BookBorrowerType,
  BookCountCategory,
  BookTitleCategory,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * ຄັງປື້ມ — the school's books, in the four shapes the office keeps them.
 *
 * - **Counts** (ຄູ່ມືຄູ, ແບບຮຽນ): how many copies of each subject's book there
 *   are at each grade, one sheet per school year. Not titles: the office counts
 *   them as a grid and that is what is stored.
 * - **Titles** (ປື້ມອຸປະຖຳ, ເອກະສານອ້າງອີງ): one row per title, with how many
 *   copies, where they came from and what they cost — and the loans against them.
 * - **Workbook sales** (ການສ້າງປື້ມແບບບົດເຝິກຫັດອອກຂາຍ): one sheet per school
 *   year of what was printed per grade and what it sold for.
 *
 * No total is stored anywhere — see `library-math.ts`.
 */

// ── Counts ──────────────────────────────────────────────────────────────────

@Schema({ _id: false })
export class BookGradeCount {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'GradeLevel', required: true })
  gradeLevelId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  quantity: number;
}
export const BookGradeCountSchema = SchemaFactory.createForClass(BookGradeCount);

/** One line of the sheet — "ວິຊາ ພາສາລາວ" — with its copies per grade. */
@Schema({ _id: false })
export class BookCountRow {
  /**
   * The row's own identity, kept across saves.
   *
   * A loan of "ແບບຮຽນ ຄະນິດສາດ ມ.5" points at this, not at the name: the sheet is
   * saved whole and its rows renamed freely, and a loan that followed the name
   * would lose its book the first time somebody corrected a spelling.
   */
  @Prop({ type: SchemaTypes.ObjectId, default: () => new Types.ObjectId() })
  rowId: Types.ObjectId;

  /** Free text: the sheet's lines are books, not the timetable's subjects. */
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: [BookGradeCountSchema], default: [] })
  counts: BookGradeCount[];
}
export const BookCountRowSchema = SchemaFactory.createForClass(BookCountRow);

export type BookCountSheetDocument = HydratedDocument<BookCountSheet>;

@Schema({ collection: 'bookCountSheets', ...baseSchemaOptions })
export class BookCountSheet extends SoftDeletableDocument {
  @Prop({ type: String, required: true, enum: BOOK_COUNT_CATEGORIES })
  category: BookCountCategory;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: [BookCountRowSchema], default: [] })
  rows: BookCountRow[];

  @Prop({ type: String, default: null, trim: true })
  note?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  updatedById?: Types.ObjectId | null;
}
export const BookCountSheetSchema = SchemaFactory.createForClass(BookCountSheet);
BookCountSheetSchema.index(
  { category: 1, schoolYearId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

// ── Titles ──────────────────────────────────────────────────────────────────

export type BookTitleDocument = HydratedDocument<BookTitle>;

@Schema({ collection: 'bookTitles', ...baseSchemaOptions })
export class BookTitle extends SoftDeletableDocument {
  @Prop({ type: String, required: true, enum: BOOK_TITLE_CATEGORIES, index: true })
  category: BookTitleCategory;

  /** ຊື່ປື້ມ. */
  @Prop({ type: String, required: true, trim: true })
  title: string;

  /** ຈຳນວນ — copies the school holds. */
  @Prop({ type: Number, required: true, min: 0 })
  quantity: number;

  /** ລາຄາ/ຫົວ in ກີບ, where it is known. */
  @Prop({ type: Number, default: null, min: 0 })
  unitPrice?: number | null;

  /** Where the books came from — "Book Festival 2026", a donor, a shop. */
  @Prop({ type: String, default: null, trim: true, index: true })
  source?: string | null;

  /** ວັນທີຊື້ / ວັນທີໄດ້ຮັບ. */
  @Prop({ type: Date, default: null })
  acquiredOn?: Date | null;

  /**
   * ສົກຮຽນ as the sheet writes it — "2019-2020". Text rather than a reference:
   * the reference list goes back to years the system never had.
   */
  @Prop({ type: String, default: null, trim: true })
  academicYear?: string | null;

  @Prop({ type: String, default: null, trim: true })
  note?: string | null;
}
export const BookTitleSchema = SchemaFactory.createForClass(BookTitle);
BookTitleSchema.index({ category: 1, title: 1 });

// ── Loans ───────────────────────────────────────────────────────────────────

export type BookLoanDocument = HydratedDocument<BookLoan>;

/**
 * ການຢືມ — copies of one book out with one person, until they come back.
 *
 * The book is either a title (ປື້ມອຸປະຖຳ, ເອກະສານອ້າງອີງ) or one cell of a
 * count sheet (ຄູ່ມືຄູ / ແບບຮຽນ: this subject's book at this grade) — exactly
 * one of the two, which the service enforces.
 */
@Schema({ collection: 'bookLoans', ...baseSchemaOptions })
export class BookLoan extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'BookTitle', default: null, index: true })
  bookTitleId?: Types.ObjectId | null;

  /** The count sheet, for a ຄູ່ມືຄູ / ແບບຮຽນ loan. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'BookCountSheet', default: null, index: true })
  countSheetId?: Types.ObjectId | null;

  /** The sheet row — `BookCountRow.rowId`. */
  @Prop({ type: SchemaTypes.ObjectId, default: null })
  rowId?: Types.ObjectId | null;

  /** The grade column of that row. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'GradeLevel', default: null })
  gradeLevelId?: Types.ObjectId | null;

  /**
   * The book as it read when lent — "ແບບຮຽນ · ວິຊາ ຄະນິດສາດ · ມ.5", or the
   * title — so the loan still says what it was after a rename or a deletion.
   */
  @Prop({ type: String, default: null, trim: true })
  bookLabel?: string | null;

  /** `donated` / `reference` / `teacher_guide` / `textbook`, copied at lending. */
  @Prop({ type: String, default: null })
  bookCategory?: string | null;

  @Prop({ type: String, required: true, enum: BOOK_BORROWER_TYPES })
  borrowerType: BookBorrowerType;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', default: null, index: true })
  teacherId?: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Student', default: null, index: true })
  studentId?: Types.ObjectId | null;

  /** The name as it read on the day, so the loan still says who after a record changes. */
  @Prop({ type: String, required: true, trim: true })
  borrowerName: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: Date, required: true })
  loanedOn: Date;

  @Prop({ type: Date, default: null })
  dueOn?: Date | null;

  /** `null` while the book is out. */
  @Prop({ type: Date, default: null, index: true })
  returnedOn?: Date | null;

  @Prop({ type: String, default: null, trim: true })
  note?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  recordedById?: Types.ObjectId | null;
}
export const BookLoanSchema = SchemaFactory.createForClass(BookLoan);
BookLoanSchema.index({ bookTitleId: 1, returnedOn: 1 });
BookLoanSchema.index({ countSheetId: 1, returnedOn: 1 });

// ── Workbook sales ──────────────────────────────────────────────────────────

/** One grade's printing: what is in the set, how many sets, at what price. */
@Schema({ _id: false })
export class WorkbookSaleLine {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'GradeLevel', required: true })
  gradeLevelId: Types.ObjectId;

  /** ລາຍຊື່ວິຊາໃນ 1 ຊຸດ — "ພາສາລາວ-ວັນນະຄະດີ, ເຄມີ, ຟີຊິກ, ຊີວະ, ເລກ". */
  @Prop({ type: String, default: null, trim: true })
  subjects?: string | null;

  @Prop({ type: Number, required: true, min: 0 })
  booksPerSet: number;

  @Prop({ type: Number, required: true, min: 0 })
  setsProduced: number;

  @Prop({ type: Number, required: true, min: 0 })
  pricePerSet: number;
}
export const WorkbookSaleLineSchema = SchemaFactory.createForClass(WorkbookSaleLine);

/** A sale outside the sets — the sheet's "ໄດ້ຂາຍເພີ່ມຕື່ມອີກ 10 ຫົວ". */
@Schema({ _id: false })
export class WorkbookExtraSale {
  @Prop({ type: Date, default: null })
  date?: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'GradeLevel', default: null })
  gradeLevelId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true })
  description: string;

  /** Whole sets sold, when the sale was by the set; 0 for single books. */
  @Prop({ type: Number, default: 0, min: 0 })
  sets: number;

  /** Books handed over — a set's books included. */
  @Prop({ type: Number, required: true, min: 0 })
  books: number;

  /** ກີບ received. */
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;
}
export const WorkbookExtraSaleSchema = SchemaFactory.createForClass(WorkbookExtraSale);

export type WorkbookSaleSheetDocument = HydratedDocument<WorkbookSaleSheet>;

@Schema({ collection: 'workbookSaleSheets', ...baseSchemaOptions })
export class WorkbookSaleSheet extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: [WorkbookSaleLineSchema], default: [] })
  lines: WorkbookSaleLine[];

  @Prop({ type: [WorkbookExtraSaleSchema], default: [] })
  extraSales: WorkbookExtraSale[];

  /** ໝາຍເຫດ — who sells, where the money goes. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  updatedById?: Types.ObjectId | null;
}
export const WorkbookSaleSheetSchema = SchemaFactory.createForClass(WorkbookSaleSheet);
WorkbookSaleSheetSchema.index(
  { schoolYearId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
