import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { registerName } from 'src/common/utils/student-name';
import {
  BookCountSheet,
  BookCountSheetDocument,
  BookLoan,
  BookLoanDocument,
  BookTitle,
  BookTitleDocument,
  GradeLevel,
  GradeLevelDocument,
  SchoolYearDocument,
  Student,
  StudentDocument,
  Teacher,
  TeacherDocument,
  WorkbookSaleSheet,
  WorkbookSaleSheetDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { escapeRegex } from '../users/users.service';
import {
  BookCountQueryDto,
  CreateBookLoanDto,
  CreateBookTitleDto,
  QueryBookLoansDto,
  QueryBookTitlesDto,
  ReturnBookLoanDto,
  SaveBookCountDto,
  SaveWorkbookSaleDto,
  UpdateBookTitleDto,
  WorkbookSaleQueryDto,
} from './dto/library.dto';
import {
  cellBelowLoans,
  cellKey,
  copiesAvailable,
  matrixTotals,
  titleValue,
  workbookTotals,
  type MatrixTotals,
  type WorkbookTotals,
} from './library-math';

export interface LibraryGrade {
  id: string;
  code: string;
  nameLo: string;
}

export interface BookCountSheetView {
  category: string;
  schoolYear: { id: string; nameLo: string | null };
  grades: LibraryGrade[];
  /** `null` until the sheet is first saved — there is nothing to lend from yet. */
  sheetId: string | null;
  rows: {
    rowId: string;
    name: string;
    counts: Record<string, number>;
    /** gradeLevelId → copies of this row's book out on loan. */
    onLoan: Record<string, number>;
  }[];
  totals: MatrixTotals;
  note: string | null;
  updatedAt: string | null;
}

/** Anything that can be lent, for the loan dialog's book picker. */
export interface Lendable {
  /** `t:<titleId>`, or `c:<sheetId>:<rowId>:<gradeLevelId>` for a sheet cell. */
  key: string;
  label: string;
  category: string;
  available: number;
}

export interface BookTitleView {
  id: string;
  category: string;
  title: string;
  quantity: number;
  unitPrice: number | null;
  value: number | null;
  source: string | null;
  acquiredOn: string | null;
  academicYear: string | null;
  note: string | null;
  onLoan: number;
  available: number;
}

export interface WorkbookSaleSheetView {
  schoolYear: { id: string; nameLo: string | null };
  grades: LibraryGrade[];
  lines: {
    gradeLevelId: string;
    subjects: string | null;
    booksPerSet: number;
    setsProduced: number;
    pricePerSet: number;
  }[];
  extraSales: {
    date: string | null;
    gradeLevelId: string | null;
    description: string;
    sets: number;
    books: number;
    amount: number;
  }[];
  totals: WorkbookTotals;
  note: string | null;
  updatedAt: string | null;
}

const COUNT_LABEL_LO: Record<string, string> = { teacher_guide: 'ຄູ່ມືຄູ', textbook: 'ແບບຮຽນ' };

/** ມ.5 — read off the grade's code; the register's full name is too long for a label. */
const gradeShort = (grade: { code?: string; nameLo?: string } | null | undefined) => {
  const match = /^m(\d+)$/i.exec(grade?.code ?? '');
  return match ? `ມ.${match[1]}` : (grade?.nameLo ?? '');
};

const isoDate = (value: Date | null | undefined) =>
  value ? new Date(value).toISOString().slice(0, 10) : null;
const utcDay = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

/**
 * ຄັງປື້ມ — the counts, the titles and their loans, and the workbook sales.
 *
 * The two sheets (counts, sales) are saved whole and read with their totals
 * worked out; titles are ordinary records with the copies still on the shelf
 * read off the loans each time.
 */
@Injectable()
export class LibraryService {
  constructor(
    @InjectModel(BookCountSheet.name) private readonly counts: Model<BookCountSheetDocument>,
    @InjectModel(BookTitle.name) private readonly titles: Model<BookTitleDocument>,
    @InjectModel(BookLoan.name) private readonly loans: Model<BookLoanDocument>,
    @InjectModel(WorkbookSaleSheet.name)
    private readonly sales: Model<WorkbookSaleSheetDocument>,
    @InjectModel(GradeLevel.name) private readonly grades: Model<GradeLevelDocument>,
    @InjectModel(Teacher.name) private readonly teachers: Model<TeacherDocument>,
    @InjectModel(Student.name) private readonly students: Model<StudentDocument>,
    private readonly schoolYears: SchoolYearsService,
    private readonly audit: AuditLogsService,
  ) {}

  // ── Counts ────────────────────────────────────────────────────────────────

  async getCounts(query: BookCountQueryDto): Promise<BookCountSheetView> {
    const year = await this.year(query.schoolYearId);
    const [grades, sheet] = await Promise.all([
      this.gradeColumns(),
      this.counts
        .findOne({ category: query.category, schoolYearId: year._id, deletedAt: null })
        .lean()
        .exec(),
    ]);
    // Rows written before rows had ids (the first import) get theirs now, once.
    if (sheet && sheet.rows.some((row) => !row.rowId)) {
      for (const row of sheet.rows) row.rowId ??= new Types.ObjectId();
      await this.counts.updateOne({ _id: sheet._id }, { $set: { rows: sheet.rows } }).exec();
    }
    const out = sheet ? await this.outstandingByCell(sheet._id) : new Map<string, number>();

    const rows = (sheet?.rows ?? []).map((row) => {
      const rowId = String(row.rowId);
      return {
        rowId,
        name: row.name,
        counts: Object.fromEntries(
          row.counts.map((count) => [String(count.gradeLevelId), count.quantity]),
        ),
        onLoan: Object.fromEntries(
          grades
            .map((grade) => [grade.id, out.get(cellKey(rowId, grade.id)) ?? 0] as const)
            .filter(([, onLoan]) => onLoan > 0),
        ),
      };
    });
    return {
      category: query.category,
      schoolYear: { id: year._id.toString(), nameLo: year.nameLo ?? null },
      sheetId: sheet ? String(sheet._id) : null,
      grades,
      rows,
      totals: matrixTotals(
        rows,
        grades.map((grade) => grade.id),
      ),
      note: sheet?.note ?? null,
      updatedAt: sheet?.updatedAt ? new Date(sheet.updatedAt).toISOString() : null,
    };
  }

  async saveCounts(
    dto: SaveBookCountDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<BookCountSheetView> {
    const year = await this.year(dto.schoolYearId);
    const known = new Set((await this.gradeColumns()).map((grade) => grade.id));

    const rows = dto.rows.map((row) => {
      const seen = new Set<string>();
      const counts = row.counts
        // A cell left empty is "—", not a row of zeros.
        .filter((count) => known.has(count.gradeLevelId) && count.quantity > 0)
        .map((count) => {
          if (seen.has(count.gradeLevelId)) throw AppException.badRequest('library.duplicateGrade');
          seen.add(count.gradeLevelId);
          return { gradeLevelId: new Types.ObjectId(count.gradeLevelId), quantity: count.quantity };
        });
      return {
        rowId: row.rowId ? new Types.ObjectId(row.rowId) : new Types.ObjectId(),
        name: row.name.trim(),
        counts,
      };
    });

    // Books out on loan have to stay on the sheet: no row deleted, no count cut
    // below what is lent from it.
    const existing = await this.counts
      .findOne({ category: dto.category, schoolYearId: year._id, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (existing) {
      const blocked = cellBelowLoans(
        await this.outstandingByCell(existing._id),
        rows.map((row) => ({
          rowId: String(row.rowId),
          counts: Object.fromEntries(
            row.counts.map((count) => [String(count.gradeLevelId), count.quantity]),
          ),
        })),
      );
      if (blocked) {
        throw AppException.badRequest('library.quantityBelowLoans', {
          onLoan: blocked.onLoan,
          quantity: blocked.quantity,
        });
      }
    }

    const saved = await this.counts
      .findOneAndUpdate(
        { category: dto.category, schoolYearId: year._id, deletedAt: null },
        {
          $set: {
            rows,
            note: dto.note?.trim() || null,
            updatedById: new Types.ObjectId(actor.sub),
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'bookCountSheets',
      entityId: saved._id,
      newValue: { category: dto.category, schoolYearId: year._id.toString(), rows: rows.length },
      ip,
    });

    return this.getCounts({ category: dto.category, schoolYearId: year._id.toString() });
  }

  // ── Titles ────────────────────────────────────────────────────────────────

  async findTitles(query: QueryBookTitlesDto): Promise<PaginatedResponse<BookTitleView>> {
    const filter: FilterQuery<BookTitleDocument> = { deletedAt: null };
    if (query.category) filter.category = query.category;
    if (query.source) filter.source = query.source;
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { source: { $regex: escaped, $options: 'i' } },
        { note: { $regex: escaped, $options: 'i' } },
      ];
    }
    if (query.onLoan) {
      const out = await this.loans.distinct('bookTitleId', { returnedOn: null, deletedAt: null });
      filter._id = { $in: out };
    }

    const sort = query.toSort(['title', 'quantity', 'unitPrice', 'acquiredOn', 'createdAt'], {
      createdAt: 1,
    });
    const [rows, total] = await Promise.all([
      this.titles.find(filter).sort(sort).skip(query.skip).limit(query.limit).lean().exec(),
      this.titles.countDocuments(filter).exec(),
    ]);

    const out = await this.outstandingByTitle(rows.map((row) => row._id));
    return new PaginatedResponse(
      rows.map((row) => this.titleView(row, out.get(String(row._id)) ?? 0)),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * The headline over a category: how many titles and copies, what they are
   * worth, how many are out — and the same per source, which is how the
   * Book Festival sheets are read ("2026: 53 ຫົວ, 3,504,000 ກີບ").
   */
  async titleSummary(category?: string) {
    const rows = await this.titles
      .find({ deletedAt: null, ...(category ? { category } : {}) })
      .select('source quantity unitPrice')
      .lean()
      .exec();
    const out = await this.outstandingByTitle(rows.map((row) => row._id));

    const bySource = new Map<string, { titles: number; copies: number; value: number }>();
    let copies = 0;
    let value = 0;
    let onLoan = 0;
    for (const row of rows) {
      const worth = titleValue(row.quantity, row.unitPrice) ?? 0;
      copies += row.quantity;
      value += worth;
      onLoan += out.get(String(row._id)) ?? 0;
      const key = row.source ?? '';
      const entry = bySource.get(key) ?? { titles: 0, copies: 0, value: 0 };
      entry.titles += 1;
      entry.copies += row.quantity;
      entry.value += worth;
      bySource.set(key, entry);
    }
    return {
      titles: rows.length,
      copies,
      value,
      onLoan,
      sources: [...bySource.entries()]
        .map(([source, entry]) => ({ source: source || null, ...entry }))
        .sort((a, b) => (a.source ?? '').localeCompare(b.source ?? '')),
    };
  }

  async createTitle(dto: CreateBookTitleDto, actor: AuthenticatedUser, ip: string | null) {
    const created = await this.titles.create({
      category: dto.category,
      title: dto.title.trim(),
      quantity: dto.quantity,
      unitPrice: dto.unitPrice ?? null,
      source: dto.source?.trim() || null,
      acquiredOn: dto.acquiredOn ? utcDay(dto.acquiredOn) : null,
      academicYear: dto.academicYear?.trim() || null,
      note: dto.note?.trim() || null,
    });
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'create',
      entityType: 'bookTitles',
      entityId: created._id,
      newValue: created.toObject() as unknown as Record<string, unknown>,
      ip,
    });
    return this.titleView(created.toObject(), 0);
  }

  async updateTitle(
    id: string,
    dto: UpdateBookTitleDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const title = await this.titleOrFail(id);
    const out = (await this.outstandingByTitle([title._id])).get(id) ?? 0;
    if (dto.quantity !== undefined && dto.quantity < out) {
      throw AppException.badRequest('library.quantityBelowLoans', { onLoan: out });
    }

    const text = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : value.trim() || null;
    const set: Record<string, unknown> = {
      category: dto.category,
      title: dto.title?.trim(),
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      source: text(dto.source),
      acquiredOn:
        dto.acquiredOn === undefined ? undefined : dto.acquiredOn ? utcDay(dto.acquiredOn) : null,
      academicYear: text(dto.academicYear),
      note: text(dto.note),
    };
    for (const key of Object.keys(set)) if (set[key] === undefined) delete set[key];

    const before = title.toObject() as unknown as Record<string, unknown>;
    const updated = await this.titles
      .findByIdAndUpdate(title._id, { $set: set }, { new: true })
      .lean()
      .exec();
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'bookTitles',
      entityId: title._id,
      oldValue: before,
      newValue: set,
      ip,
    });
    return this.titleView(updated!, out);
  }

  /** Refused while copies are out: the loan would point at a title nobody can see. */
  async removeTitle(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const title = await this.titleOrFail(id);
    if (((await this.outstandingByTitle([title._id])).get(id) ?? 0) > 0) {
      throw AppException.conflict('library.hasOutstandingLoans');
    }
    title.deletedAt = new Date();
    await title.save();
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'delete',
      entityType: 'bookTitles',
      entityId: title._id,
      ip,
    });
  }

  // ── Loans ─────────────────────────────────────────────────────────────────

  async findLoans(query: QueryBookLoansDto) {
    const filter: FilterQuery<BookLoanDocument> = { deletedAt: null };
    if (query.bookTitleId) filter.bookTitleId = new Types.ObjectId(query.bookTitleId);
    if (query.outstanding === true) filter.returnedOn = null;
    if (query.outstanding === false) filter.returnedOn = { $ne: null };
    if (query.search) {
      const escaped = escapeRegex(query.search);
      const matching = await this.titles.distinct('_id', {
        title: { $regex: escaped, $options: 'i' },
        deletedAt: null,
      });
      filter.$or = [
        { borrowerName: { $regex: escaped, $options: 'i' } },
        { bookLabel: { $regex: escaped, $options: 'i' } },
        { bookTitleId: { $in: matching } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.loans
        .find(filter)
        .populate('bookTitleId', 'title category')
        // Outstanding first, oldest loan at the top: that is the one to chase.
        .sort({ returnedOn: 1, loanedOn: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.loans.countDocuments(filter).exec(),
    ]);
    return new PaginatedResponse(
      rows.map((row) => this.loanView(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async createLoan(dto: CreateBookLoanDto, actor: AuthenticatedUser, ip: string | null) {
    const quantity = dto.quantity ?? 1;
    const book = await this.loanTarget(dto);
    if (book.available < quantity) {
      throw AppException.badRequest('library.notEnoughCopies', { available: book.available });
    }

    const borrower = await this.borrower(dto);
    const created = await this.loans.create({
      ...book.fields,
      borrowerType: dto.borrowerType,
      ...borrower,
      quantity,
      loanedOn: utcDay(dto.loanedOn),
      dueOn: dto.dueOn ? utcDay(dto.dueOn) : null,
      note: dto.note?.trim() || null,
      recordedById: new Types.ObjectId(actor.sub),
    });
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'create',
      entityType: 'bookLoans',
      entityId: created._id,
      newValue: { book: book.fields.bookLabel, borrowerName: borrower.borrowerName, quantity },
      ip,
    });
    const populated = await this.loans
      .findById(created._id)
      .populate('bookTitleId', 'title category')
      .lean()
      .exec();
    return this.loanView(populated!);
  }

  /**
   * Everything that can be lent, matching `search` — titles, and every cell of
   * the active year's ຄູ່ມືຄູ / ແບບຮຽນ sheets — for the loan dialog's picker.
   */
  async lendables(search?: string): Promise<Lendable[]> {
    const pattern = search?.trim() ? new RegExp(escapeRegex(search.trim()), 'i') : null;

    const titleRows = await this.titles
      .find({ deletedAt: null, ...(pattern ? { title: pattern } : {}) })
      .sort({ title: 1 })
      .limit(25)
      .lean()
      .exec();
    const titleOut = await this.outstandingByTitle(titleRows.map((row) => row._id));
    const fromTitles = titleRows.map((row) => ({
      key: `t:${String(row._id)}`,
      label: row.title,
      category: row.category,
      available: copiesAvailable(row.quantity, titleOut.get(String(row._id)) ?? 0),
    }));

    const year = await this.schoolYears.findActive();
    const fromSheets: Lendable[] = [];
    if (year) {
      const [sheets, grades] = await Promise.all([
        this.counts.find({ schoolYearId: year._id, deletedAt: null }).lean().exec(),
        this.grades.find({ deletedAt: null }).select('code nameLo level').lean().exec(),
      ]);
      const gradeById = new Map(grades.map((grade) => [String(grade._id), grade]));
      for (const sheet of sheets) {
        const out = await this.outstandingByCell(sheet._id);
        for (const row of sheet.rows) {
          if (!row.rowId) continue;
          for (const count of row.counts) {
            const grade = gradeById.get(String(count.gradeLevelId));
            const label = `${COUNT_LABEL_LO[sheet.category]} · ${row.name} · ${gradeShort(grade)}`;
            if (pattern && !pattern.test(label)) continue;
            fromSheets.push({
              key: `c:${String(sheet._id)}:${String(row.rowId)}:${String(count.gradeLevelId)}`,
              label,
              category: sheet.category,
              available: copiesAvailable(
                count.quantity,
                out.get(cellKey(String(row.rowId), String(count.gradeLevelId))) ?? 0,
              ),
            });
          }
        }
      }
    }
    return [...fromTitles, ...fromSheets.slice(0, 50)];
  }

  /** The book a loan names, how many are on the shelf, and the fields to store. */
  private async loanTarget(dto: CreateBookLoanDto) {
    const isCell = Boolean(dto.countSheetId || dto.rowId || dto.gradeLevelId);
    if (Boolean(dto.bookTitleId) === isCell) {
      throw AppException.badRequest('library.loanTargetRequired');
    }

    if (dto.bookTitleId) {
      const title = await this.titleOrFail(dto.bookTitleId);
      const out = (await this.outstandingByTitle([title._id])).get(dto.bookTitleId) ?? 0;
      return {
        available: copiesAvailable(title.quantity, out),
        fields: {
          bookTitleId: title._id,
          bookLabel: title.title,
          bookCategory: title.category as string,
        },
      };
    }

    if (!dto.countSheetId || !dto.rowId || !dto.gradeLevelId) {
      throw AppException.badRequest('library.loanTargetRequired');
    }
    const sheet = await this.counts
      .findOne({ _id: new Types.ObjectId(dto.countSheetId), deletedAt: null })
      .lean()
      .exec();
    const row = sheet?.rows.find((candidate) => String(candidate.rowId) === dto.rowId);
    const cell = row?.counts.find((count) => String(count.gradeLevelId) === dto.gradeLevelId);
    if (!sheet || !row || !cell) throw AppException.notFound();

    const grade = await this.grades.findById(cell.gradeLevelId).select('code nameLo').lean().exec();
    const out = (await this.outstandingByCell(sheet._id)).get(cellKey(dto.rowId, dto.gradeLevelId));
    return {
      available: copiesAvailable(cell.quantity, out ?? 0),
      fields: {
        countSheetId: sheet._id,
        rowId: row.rowId,
        gradeLevelId: cell.gradeLevelId,
        bookLabel: `${COUNT_LABEL_LO[sheet.category]} · ${row.name} · ${gradeShort(grade)}`,
        bookCategory: sheet.category as string,
      },
    };
  }

  async returnLoan(
    id: string,
    dto: ReturnBookLoanDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const loan = await this.loans.findOne({ _id: id, deletedAt: null }).exec();
    if (!loan) throw AppException.notFound();
    if (loan.returnedOn) throw AppException.conflict('library.loanAlreadyReturned');

    loan.returnedOn = dto.returnedOn ? utcDay(dto.returnedOn) : utcDay(new Date().toISOString());
    await loan.save();
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'bookLoans',
      entityId: loan._id,
      newValue: { returnedOn: isoDate(loan.returnedOn) },
      ip,
    });
    const populated = await this.loans
      .findById(loan._id)
      .populate('bookTitleId', 'title category')
      .lean()
      .exec();
    return this.loanView(populated!);
  }

  // ── Workbook sales ────────────────────────────────────────────────────────

  async getWorkbookSales(query: WorkbookSaleQueryDto): Promise<WorkbookSaleSheetView> {
    const year = await this.year(query.schoolYearId);
    const [grades, sheet] = await Promise.all([
      this.gradeColumns(),
      this.sales.findOne({ schoolYearId: year._id, deletedAt: null }).lean().exec(),
    ]);
    const lines = (sheet?.lines ?? []).map((line) => ({
      gradeLevelId: String(line.gradeLevelId),
      subjects: line.subjects ?? null,
      booksPerSet: line.booksPerSet,
      setsProduced: line.setsProduced,
      pricePerSet: line.pricePerSet,
    }));
    const extraSales = (sheet?.extraSales ?? []).map((extra) => ({
      date: isoDate(extra.date),
      gradeLevelId: extra.gradeLevelId ? String(extra.gradeLevelId) : null,
      description: extra.description,
      sets: extra.sets ?? 0,
      books: extra.books,
      amount: extra.amount,
    }));
    return {
      schoolYear: { id: year._id.toString(), nameLo: year.nameLo ?? null },
      grades,
      lines,
      extraSales,
      totals: workbookTotals(lines, extraSales),
      note: sheet?.note ?? null,
      updatedAt: sheet?.updatedAt ? new Date(sheet.updatedAt).toISOString() : null,
    };
  }

  async saveWorkbookSales(
    dto: SaveWorkbookSaleDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<WorkbookSaleSheetView> {
    const year = await this.year(dto.schoolYearId);
    const known = new Set((await this.gradeColumns()).map((grade) => grade.id));
    const seen = new Set<string>();
    const lines = dto.lines.map((line) => {
      if (!known.has(line.gradeLevelId)) throw AppException.notFound();
      if (seen.has(line.gradeLevelId)) throw AppException.badRequest('library.duplicateGrade');
      seen.add(line.gradeLevelId);
      return {
        gradeLevelId: new Types.ObjectId(line.gradeLevelId),
        subjects: line.subjects?.trim() || null,
        booksPerSet: line.booksPerSet,
        setsProduced: line.setsProduced,
        pricePerSet: line.pricePerSet,
      };
    });
    const extraSales = dto.extraSales.map((extra) => ({
      date: extra.date ? utcDay(extra.date) : null,
      gradeLevelId: extra.gradeLevelId ? new Types.ObjectId(extra.gradeLevelId) : null,
      description: extra.description.trim(),
      sets: extra.sets ?? 0,
      books: extra.books,
      amount: extra.amount,
    }));

    const saved = await this.sales
      .findOneAndUpdate(
        { schoolYearId: year._id, deletedAt: null },
        {
          $set: {
            lines,
            extraSales,
            note: dto.note?.trim() || null,
            updatedById: new Types.ObjectId(actor.sub),
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    const totals = workbookTotals(lines, extraSales);
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'workbookSaleSheets',
      entityId: saved._id,
      newValue: {
        schoolYearId: year._id.toString(),
        sets: totals.sets,
        amount: totals.grandAmount,
      },
      ip,
    });
    return this.getWorkbookSales({ schoolYearId: year._id.toString() });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async year(schoolYearId?: string): Promise<SchoolYearDocument> {
    if (!schoolYearId) return this.schoolYears.getActiveOrFail();
    return (await this.schoolYears.findOneOrFail(schoolYearId)) as SchoolYearDocument;
  }

  /** ມ.1 … ມ.7 in order — the sheets' columns. */
  private async gradeColumns(): Promise<LibraryGrade[]> {
    const rows = await this.grades
      .find({ deletedAt: null })
      .sort({ level: 1 })
      .select('code nameLo')
      .lean()
      .exec();
    return rows.map((row) => ({ id: String(row._id), code: row.code, nameLo: row.nameLo }));
  }

  private async titleOrFail(id: string): Promise<BookTitleDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const title = await this.titles.findOne({ _id: id, deletedAt: null }).exec();
    if (!title) throw AppException.notFound();
    return title;
  }

  /** bookTitleId → copies out and not yet back. */
  private async outstandingByTitle(ids: Types.ObjectId[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.loans
      .aggregate<{ _id: Types.ObjectId; quantity: number }>([
        { $match: { bookTitleId: { $in: ids }, returnedOn: null, deletedAt: null } },
        { $group: { _id: '$bookTitleId', quantity: { $sum: '$quantity' } } },
      ])
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.quantity]));
  }

  /** `rowId:gradeLevelId` → copies of that sheet cell out and not yet back. */
  private async outstandingByCell(sheetId: Types.ObjectId): Promise<Map<string, number>> {
    const rows = await this.loans
      .aggregate<{
        _id: { rowId: Types.ObjectId; gradeLevelId: Types.ObjectId };
        quantity: number;
      }>([
        { $match: { countSheetId: sheetId, returnedOn: null, deletedAt: null } },
        {
          $group: {
            _id: { rowId: '$rowId', gradeLevelId: '$gradeLevelId' },
            quantity: { $sum: '$quantity' },
          },
        },
      ])
      .exec();
    return new Map(
      rows.map((row) => [
        cellKey(String(row._id.rowId), String(row._id.gradeLevelId)),
        row.quantity,
      ]),
    );
  }

  /** The borrower's ids and the name to print, checked against the register. */
  private async borrower(dto: CreateBookLoanDto) {
    if (dto.borrowerType === 'teacher') {
      if (!dto.teacherId) throw AppException.badRequest('library.borrowerRequired');
      const teacher = await this.teachers
        .findOne({ _id: dto.teacherId, deletedAt: null })
        .select('firstNameLo lastNameLo')
        .lean()
        .exec();
      if (!teacher) throw AppException.notFound();
      return {
        teacherId: teacher._id,
        studentId: null,
        borrowerName: `${teacher.firstNameLo} ${teacher.lastNameLo}`.trim(),
      };
    }
    if (dto.borrowerType === 'student') {
      if (!dto.studentId) throw AppException.badRequest('library.borrowerRequired');
      const student = await this.students
        .findOne({ _id: dto.studentId, deletedAt: null })
        .lean()
        .exec();
      if (!student) throw AppException.notFound();
      return {
        teacherId: null,
        studentId: student._id,
        borrowerName: registerName(student as never) ?? student.studentCode,
      };
    }
    const name = dto.borrowerName?.trim();
    if (!name) throw AppException.badRequest('library.borrowerRequired');
    return { teacherId: null, studentId: null, borrowerName: name };
  }

  private titleView(source: object, onLoan: number): BookTitleView {
    const row = source as Record<string, unknown>;
    const quantity = row.quantity as number;
    const unitPrice = (row.unitPrice as number | null | undefined) ?? null;
    return {
      id: String(row._id),
      category: row.category as string,
      title: row.title as string,
      quantity,
      unitPrice,
      value: titleValue(quantity, unitPrice),
      source: (row.source as string | null | undefined) ?? null,
      acquiredOn: isoDate(row.acquiredOn as Date | null | undefined),
      academicYear: (row.academicYear as string | null | undefined) ?? null,
      note: (row.note as string | null | undefined) ?? null,
      onLoan,
      available: copiesAvailable(quantity, onLoan),
    };
  }

  private loanView(source: object) {
    const row = source as Record<string, unknown>;
    const title = row.bookTitleId as {
      _id: Types.ObjectId;
      title?: string;
      category?: string;
    } | null;
    return {
      id: String(row._id),
      bookTitleId: title?._id ? String(title._id) : null,
      countSheetId: row.countSheetId ? String(row.countSheetId) : null,
      // The title as it reads now, where there is one; the label taken at lending otherwise.
      bookTitle: title?.title ?? (row.bookLabel as string | null) ?? null,
      bookCategory: title?.category ?? (row.bookCategory as string | null) ?? null,
      borrowerType: row.borrowerType as string,
      teacherId: row.teacherId ? String(row.teacherId) : null,
      studentId: row.studentId ? String(row.studentId) : null,
      borrowerName: row.borrowerName as string,
      quantity: row.quantity as number,
      loanedOn: isoDate(row.loanedOn as Date),
      dueOn: isoDate(row.dueOn as Date | null),
      returnedOn: isoDate(row.returnedOn as Date | null),
      note: (row.note as string | null | undefined) ?? null,
    };
  }
}
