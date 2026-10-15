import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { FilterQuery, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { isStudying } from 'src/common/utils/current-roll';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  Classroom,
  ClassroomDocument,
  Enrollment,
  EnrollmentDocument,
  ExamImage,
  ExamPaper,
  ExamPaperDocument,
  ExamQuestion,
  ExamResponse,
  ExamResponseDocument,
  ExamScan,
  ExamScanDocument,
  SemesterDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { COLUMN_MAX, monthsForSemester } from '../monthly-marks/monthly-grading';
import { MonthlyMarksService } from '../monthly-marks/monthly-marks.service';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import { DocxNotAWordFileError, ParsedExam, parseExamDocx } from './docx-exam.parser';
import {
  AnswerSheetsQueryDto,
  ExamImageDto,
  ExamQuestionDto,
  GenerateVariantsDto,
  PushToMonthlyMarksDto,
  QueryExamPapersDto,
  ResponsesQueryDto,
  SaveResponseDto,
  ScansQueryDto,
  SeatPlanQueryDto,
  UpdateScanDto,
  UpdateExamPaperDto,
  UploadExamPaperDto,
} from './dto/exam-paper.dto';
import { GradedQuestion, gradeSheet } from './grading';
import { readAnswerSheet } from './omr/reader';
import { answerSheetLayout, MIN_CODE_DIGITS } from './print/answer-sheet.layout';
import { AnswerSheetRenderer } from './print/answer-sheet.renderer';
import { ExamPaperDocxWriter } from './print/exam-paper.docx.writer';
import {
  ExamPaperRenderer,
  OPTION_LETTERS,
  PrintImage,
  PrintPaper,
  SeatPlanStudent,
} from './print/exam-paper.renderer';
import { drawVariants, newSeed, seatClass } from './variants';

const SORTABLE = ['createdAt', 'updatedAt', 'title', 'generatedAt'] as const;

interface RollStudent extends SeatPlanStudent {
  studentId: string;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;
}

const POPULATE = [
  { path: 'subjectId', select: 'code nameLo nameEn' },
  { path: 'classroomId', select: 'name' },
  { path: 'semesterId', select: 'nameLo nameEn' },
  { path: 'createdById', select: 'username fullNameLo fullNameEn' },
];

export interface ExportedFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/**
 * ບົດສອບປາລະໄນ — a multiple-choice paper from the teacher's Word file to
 * several printed sets.
 *
 * The lifecycle is upload → review → draw → print. Upload takes the file
 * apart and keeps the pieces; review is the teacher correcting what the
 * reader got wrong; drawing fixes the sets by a seed; printing lays them out
 * from the pieces and the seed, never from a copy, so a correction made after
 * the draw is in every set the next time it is printed — and the sets are
 * still the same sets.
 */
@Injectable()
export class ExamPapersService {
  private readonly logger = new Logger(ExamPapersService.name);

  constructor(
    @InjectModel(ExamPaper.name) private readonly model: Model<ExamPaperDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    @InjectModel(ExamResponse.name) private readonly responseModel: Model<ExamResponseDocument>,
    @InjectModel(ExamScan.name) private readonly scanModel: Model<ExamScanDocument>,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogsService,
    private readonly renderer: ExamPaperRenderer,
    private readonly docxWriter: ExamPaperDocxWriter,
    private readonly answerSheets: AnswerSheetRenderer,
    private readonly monthlyMarks: MonthlyMarksService,
    private readonly semesters: SemestersService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async findAll(query: QueryExamPapersDto, actor: AuthenticatedUser) {
    const filter: FilterQuery<ExamPaperDocument> = { deletedAt: null };
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.createdById) filter.createdById = new Types.ObjectId(query.createdById);
    if (query.search) filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    this.applyVisibility(filter, actor);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        // The questions are the bulk of the record and no list needs them.
        .select('-questions -variants -warnings')
        .populate(POPULATE)
        .sort(query.toSort(SORTABLE, { createdAt: -1 }))
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /** The whole paper, with a short-lived URL on every picture for the review page. */
  async findOne(id: string, actor: AuthenticatedUser) {
    const paper = await this.load(id, actor);
    const json = paper.toJSON() as unknown as Record<string, unknown> & {
      questions: (ExamQuestion & { options: { images: ExamImage[] }[] })[];
    };
    const withUrl = async (image: ExamImage) => ({
      ...image,
      url: await this.storage.getSignedUrl(image.key),
    });
    json.questions = await Promise.all(
      json.questions.map(async (question) => ({
        ...question,
        images: await Promise.all(question.images.map(withUrl)),
        options: await Promise.all(
          question.options.map(async (option) => ({
            ...option,
            images: await Promise.all(option.images.map(withUrl)),
          })),
        ),
      })),
    );
    return json;
  }

  /** A short-lived link to the file the teacher uploaded. */
  async sourceUrl(id: string, actor: AuthenticatedUser): Promise<{ url: string | null }> {
    const paper = await this.load(id, actor);
    return { url: await this.storage.getSignedUrl(paper.source?.key) };
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  /**
   * Reads the file into a paper.
   *
   * The pictures are written to the bucket under the paper's own id, which
   * means the record has to exist before its pictures do; it is created
   * empty, filled, and saved, and a reader error leaves nothing behind.
   */
  async create(
    dto: UploadExamPaperDto,
    file: Express.Multer.File,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const filename = uploadedName(file);
    if (extname(filename).toLowerCase() !== '.docx') {
      throw AppException.badRequest('examPaper.notWord');
    }

    let parsed: ParsedExam;
    try {
      parsed = await parseExamDocx(file.buffer);
    } catch (error) {
      if (error instanceof DocxNotAWordFileError) {
        throw AppException.badRequest('examPaper.notWord');
      }
      this.logger.warn(
        `Could not read ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw AppException.badRequest('examPaper.notWord');
    }

    const id = new Types.ObjectId();
    const prefix = `exam-papers/${id.toHexString()}`;

    const sourceKey = `${prefix}/source.docx`;
    await this.storage.putBuffer(sourceKey, file.buffer, CONTENT_TYPES.docx);

    const imageByParsedId = new Map<string, ExamImage>();
    for (const image of parsed.images) {
      const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
      const key = `${prefix}/images/${randomUUID()}.${extension}`;
      await this.storage.putBuffer(key, image.buffer, image.mimeType);
      imageByParsedId.set(image.id, {
        key,
        mimeType: image.mimeType,
        widthPt: image.widthPt,
        heightPt: image.heightPt,
        descentPt: image.descentPt,
      });
    }
    const resolve = (ids: string[]) =>
      ids.flatMap((parsedId) => {
        const image = imageByParsedId.get(parsedId);
        return image ? [image] : [];
      });

    const questions: ExamQuestion[] = parsed.questions.map((question) => ({
      key: randomUUID().slice(0, 8),
      section: question.section,
      text: question.text,
      images: resolve(question.imageIds),
      options: question.options.map((option) => ({
        text: option.text,
        images: resolve(option.imageIds),
      })),
      correctIndex: question.correctIndex,
      lockOptions: question.lockOptions,
    }));

    const created = await this.model.create({
      _id: id,
      title: dto.title?.trim() || filename.replace(/\.docx$/i, ''),
      createdById: new Types.ObjectId(actor.sub),
      subjectId: dto.subjectId ? new Types.ObjectId(dto.subjectId) : null,
      classroomId: dto.classroomId ? new Types.ObjectId(dto.classroomId) : null,
      semesterId: dto.semesterId ? new Types.ObjectId(dto.semesterId) : null,
      source: { key: sourceKey, filename, sizeBytes: file.size },
      preamble: parsed.preamble,
      questions,
      questionCount: questions.length,
      optionLabelStyle: parsed.optionLabelStyle,
      warnings: parsed.warnings,
      variants: [],
    });

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'create',
      entityType: 'ExamPaper',
      entityId: created._id,
      newValue: { title: created.title, questions: questions.length, file: filename },
      ip,
    });

    return this.findOne(String(created._id), actor);
  }

  // ── Review ────────────────────────────────────────────────────────────────

  /**
   * The teacher's corrections. The question list replaces the old one whole:
   * the review page holds the whole list and sends it back, which is simpler
   * than a per-question patch and cannot leave the order ambiguous.
   *
   * Sets already drawn are re-drawn from the same seed, so a typo fixed the
   * evening before the exam does not silently turn set B into a different B.
   */
  async update(id: string, dto: UpdateExamPaperDto, actor: AuthenticatedUser, ip: string | null) {
    const paper = await this.load(id, actor);
    const prefix = `exam-papers/${paper._id.toHexString()}/`;

    if (dto.title !== undefined) paper.title = dto.title.trim() || paper.title;
    if (dto.subjectId !== undefined) {
      paper.subjectId = dto.subjectId ? new Types.ObjectId(dto.subjectId) : null;
    }
    if (dto.classroomId !== undefined) {
      paper.classroomId = dto.classroomId ? new Types.ObjectId(dto.classroomId) : null;
    }
    if (dto.semesterId !== undefined) {
      paper.semesterId = dto.semesterId ? new Types.ObjectId(dto.semesterId) : null;
    }
    if (dto.preamble !== undefined) paper.preamble = dto.preamble;
    if (dto.optionLabelStyle !== undefined) paper.optionLabelStyle = dto.optionLabelStyle;
    if (dto.totalPoints !== undefined) paper.totalPoints = dto.totalPoints;

    if (dto.questions !== undefined) {
      paper.questions = dto.questions.map((question) => this.toQuestion(question, prefix));
      paper.questionCount = paper.questions.length;
      // The warnings were about the file as read; once the teacher has been
      // through the list they describe a state that no longer exists.
      paper.warnings = [];
      if (paper.variants.length > 0 && paper.seed !== null && paper.seed !== undefined) {
        paper.variants = this.draw(paper, paper.seed);
      }
    }

    await paper.save();
    // A corrected key or a changed total re-marks every sheet the same way.
    if (dto.questions !== undefined || dto.totalPoints !== undefined) await this.regradeAll(paper);

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'ExamPaper',
      entityId: paper._id,
      newValue: { fields: Object.keys(dto) },
      ip,
    });

    return this.findOne(id, actor);
  }

  private toQuestion(dto: ExamQuestionDto, prefix: string): ExamQuestion {
    const images = (list: ExamImageDto[] | undefined) =>
      (list ?? []).map((image) => {
        // A key outside the paper's prefix would print somebody else's file.
        if (!image.key.startsWith(prefix)) {
          throw AppException.badRequest('examPaper.imageNotOwned');
        }
        return {
          key: image.key,
          mimeType: image.mimeType,
          widthPt: image.widthPt,
          heightPt: image.heightPt,
          descentPt: image.descentPt ?? 0,
        };
      });
    const options = dto.options.map((option) => ({
      text: option.text.trim(),
      images: images(option.images),
    }));
    const correctIndex =
      dto.correctIndex !== null &&
      dto.correctIndex !== undefined &&
      dto.correctIndex < options.length
        ? dto.correctIndex
        : null;
    return {
      key: dto.key || randomUUID().slice(0, 8),
      section: dto.section?.trim() || null,
      text: dto.text.trim(),
      images: images(dto.images),
      options,
      correctIndex,
      lockOptions: dto.lockOptions ?? false,
    };
  }

  // ── Sets ──────────────────────────────────────────────────────────────────

  /** Draws the sets. A new seed each time unless one is given back. */
  async generate(
    id: string,
    dto: GenerateVariantsDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const paper = await this.load(id, actor);
    if (paper.questions.length === 0) throw AppException.badRequest('examPaper.noQuestions');

    paper.variantCount = dto.count;
    paper.shuffleOptions = dto.shuffleOptions ?? true;
    paper.seed = dto.seed ?? newSeed();
    paper.variants = this.draw(paper, paper.seed);
    paper.generatedAt = new Date();
    await paper.save();
    await this.regradeAll(paper);

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'ExamPaper',
      entityId: paper._id,
      newValue: { sets: dto.count, shuffleOptions: paper.shuffleOptions, seed: paper.seed },
      ip,
    });

    return this.findOne(id, actor);
  }

  private draw(paper: ExamPaperDocument, seed: number) {
    return drawVariants(
      paper.questions.map((question) => ({
        section: question.section ?? null,
        optionCount: question.options.length,
        lockOptions: question.lockOptions,
      })),
      { count: paper.variantCount, shuffleOptions: paper.shuffleOptions, seed },
    );
  }

  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const paper = await this.load(id, actor);
    paper.deletedAt = new Date();
    paper.deletedBy = new Types.ObjectId(actor.sub);
    await paper.save();
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'delete',
      entityType: 'ExamPaper',
      entityId: paper._id,
      oldValue: { title: paper.title },
      ip,
    });
  }

  // ── Printing ──────────────────────────────────────────────────────────────

  async exportSets(
    id: string,
    format: 'pdf' | 'docx',
    set: string,
    actor: AuthenticatedUser,
  ): Promise<ExportedFile> {
    const paper = await this.load(id, actor);
    if (paper.variants.length === 0) throw AppException.badRequest('examPaper.noVariants');
    const labels =
      set === 'all' ? paper.variants.map((variant) => variant.label) : [set.toUpperCase()];
    if (!labels.every((label) => paper.variants.some((variant) => variant.label === label))) {
      throw AppException.notFound('examPaper.unknownSet');
    }

    const printable = await this.toPrintPaper(paper);
    const buffer =
      format === 'docx'
        ? await this.docxWriter.writeSets(printable, labels)
        : await this.renderer.renderSets(printable, labels);
    const suffix =
      set === 'all' ? `ຊຸດ ${labels[0]}–${labels[labels.length - 1]}` : `ຊຸດ ${labels[0]}`;
    return {
      buffer,
      filename: `${fileSafe(paper.title)}／${suffix}.${format}`,
      contentType: CONTENT_TYPES[format],
    };
  }

  async answerKey(id: string, actor: AuthenticatedUser): Promise<ExportedFile> {
    const paper = await this.load(id, actor);
    if (paper.variants.length === 0) throw AppException.badRequest('examPaper.noVariants');
    const printable = await this.toPrintPaper(paper, { withImages: false });
    return {
      buffer: await this.renderer.renderAnswerKey(printable),
      filename: `${fileSafe(paper.title)}／ເສີຍ.pdf`,
      contentType: CONTENT_TYPES.pdf,
    };
  }

  /** Who sits where and holds which set — as data for the screen. */
  async seatPlan(id: string, query: SeatPlanQueryDto, actor: AuthenticatedUser) {
    const paper = await this.load(id, actor);
    if (paper.variants.length === 0) throw AppException.badRequest('examPaper.noVariants');
    const { classroom, students } = await this.roll(query.classroomId ?? paper.classroomId);
    const seated = seatClass(students, query.columns, paper.variants.length);
    return {
      classroom: { id: String(classroom._id), name: classroom.name },
      columns: query.columns,
      sets: paper.variants.map((variant) => variant.label),
      seats: seated.map((seat) => ({
        ...seat.student,
        row: seat.row,
        column: seat.column,
        set: paper.variants[seat.setIndex].label,
      })),
    };
  }

  async seatPlanPdf(
    id: string,
    query: SeatPlanQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportedFile> {
    const paper = await this.load(id, actor);
    if (paper.variants.length === 0) throw AppException.badRequest('examPaper.noVariants');
    const { classroom, students } = await this.roll(query.classroomId ?? paper.classroomId);
    const buffer = await this.renderer.renderSeatPlan({
      title: paper.title,
      classroomName: classroom.name,
      columns: query.columns,
      variants: paper.variants,
      students,
    });
    return {
      buffer,
      filename: `${fileSafe(paper.title)}／ແຈກຊຸດ／${fileSafe(classroom.name)}.pdf`,
      contentType: CONTENT_TYPES.pdf,
    };
  }

  /**
   * The class in the order it sits — by roll number, then by name.
   *
   * ກຳລັງຮຽນ only, the same list the monthly mark sheet is drawn from: a student
   * who has dropped out, moved away or been suspended can keep an `active`
   * enrollment until the office closes it, and has no paper to sit. Sheets
   * already marked for them stay in the database untouched.
   */
  private async roll(
    classroomId: Types.ObjectId | string | null | undefined,
  ): Promise<{ classroom: ClassroomDocument; students: RollStudent[] }> {
    if (!classroomId) throw AppException.badRequest('examPaper.classroomRequired');
    const classroom = await this.classroomModel
      .findOne({ _id: classroomId, deletedAt: null })
      .select('name')
      .exec();
    if (!classroom) throw AppException.notFound();

    const enrollments = await this.enrollmentModel
      .find({ classroomId: classroom._id, status: 'active', deletedAt: null })
      .select('studentId studentCode studentNameLo rollNumber')
      .populate('studentId', 'status')
      .sort({ rollNumber: 1, studentNameLo: 1 })
      .lean()
      .exec();
    const studying = enrollments.filter((row) => isStudying(row.studentId));
    if (studying.length === 0) throw AppException.badRequest('examPaper.noStudents');

    return {
      classroom,
      students: studying.map((row, index) => ({
        // Off the populated ref: `String()` of a populated lean row is `[object Object]`.
        studentId: String(refIdOf(row.studentId)),
        // Counted afresh down the list, not the enrollment's own number: pupils
        // who left keep theirs, and a ລ/ດ column running 1, 2, 4, 5 loses the
        // teacher counting down a pile of sheets.
        rollNumber: index + 1,
        studentCode: row.studentCode,
        studentNameLo: row.studentNameLo,
      })),
    };
  }

  /** The record with its pictures' bytes, ready for a renderer. */
  private async toPrintPaper(
    paper: ExamPaperDocument,
    options: { withImages?: boolean } = {},
  ): Promise<PrintPaper> {
    const withImages = options.withImages ?? true;
    const loaded = new Map<string, PrintImage | null>();
    const load = async (image: ExamImage): Promise<PrintImage | null> => {
      if (!withImages) return null;
      if (!loaded.has(image.key)) {
        const buffer = await this.storage.getBuffer(image.key);
        loaded.set(
          image.key,
          buffer
            ? {
                buffer,
                mimeType: image.mimeType,
                widthPt: image.widthPt,
                heightPt: image.heightPt,
                descentPt: image.descentPt ?? 0,
              }
            : null,
        );
      }
      return loaded.get(image.key) ?? null;
    };
    const loadAll = async (images: ExamImage[]) =>
      (await Promise.all(images.map(load))).flatMap((image) => (image ? [image] : []));

    const schoolNameLo = (await this.settings.getValue<string>('school.nameLo')) ?? '';

    return {
      title: paper.title,
      schoolNameLo,
      preamble: paper.preamble,
      optionLabelStyle: paper.optionLabelStyle,
      variants: paper.variants.map((variant) => ({
        label: variant.label,
        questionOrder: [...variant.questionOrder],
        optionOrders: variant.optionOrders.map((order) => [...order]),
      })),
      questions: await Promise.all(
        paper.questions.map(async (question) => ({
          section: question.section ?? null,
          text: question.text,
          images: await loadAll(question.images),
          correctIndex: question.correctIndex ?? null,
          options: await Promise.all(
            question.options.map(async (option) => ({
              text: option.text,
              images: await loadAll(option.images),
            })),
          ),
        })),
      ),
    };
  }

  // ── Answer sheets ─────────────────────────────────────────────────────────

  /**
   * ເຈ້ຍຕອບ — a named sheet per pupil in seat order, then the spares.
   *
   * Named from the seat plan, so the set on the sheet is the set on the
   * pupil's desk; that is what makes "who sat which set" a thing the teacher
   * never has to key in.
   */
  async answerSheetsPdf(
    id: string,
    query: AnswerSheetsQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ExportedFile> {
    const paper = await this.load(id, actor);
    if (paper.variants.length === 0) throw AppException.badRequest('examPaper.noVariants');

    let pupils: (import('./print/answer-sheet.renderer').AnswerSheetPupil | null)[] = [];
    let classroomName: string | null = null;
    if (!query.blankOnly) {
      const { classroom, students } = await this.roll(query.classroomId ?? paper.classroomId);
      classroomName = classroom.name;
      pupils = seatClass(students, query.columns, paper.variants.length).map((seat) => ({
        studentId: seat.student.studentId,
        studentCode: seat.student.studentCode,
        studentNameLo: seat.student.studentNameLo,
        set: paper.variants[seat.setIndex].label,
      }));
    }
    const blanks = query.blankOnly ? Math.max(1, query.blank) : query.blank;
    pupils.push(...Array.from({ length: blanks }, () => null));

    const subject = paper.subjectId as unknown as { nameLo?: string } | null;
    const buffer = await this.answerSheets.render({
      paperId: String(paper._id),
      title: paper.title,
      subjectLo: subject?.nameLo ?? null,
      classroomName,
      schoolNameLo: (await this.settings.getValue<string>('school.nameLo')) ?? '',
      questionCount: paper.questions.length,
      optionCount: Math.min(
        8,
        Math.max(4, ...paper.questions.map((question) => question.options.length)),
      ),
      optionLabelStyle: paper.optionLabelStyle,
      sets: paper.variants.map((variant) => variant.label),
      pupils,
    });
    return {
      buffer,
      filename: `${fileSafe(paper.title)}／ເຈ້ຍຕອບ${classroomName ? `／${fileSafe(classroomName)}` : ''}.pdf`,
      contentType: CONTENT_TYPES.pdf,
    };
  }

  // ── Marking ───────────────────────────────────────────────────────────────

  /**
   * The class with what has been keyed in for each pupil, and the class's
   * figures: average, highest, lowest, and how many got each of the
   * teacher's questions right — the one the fewest got is the one to teach
   * again.
   */
  async responses(id: string, query: ResponsesQueryDto, actor: AuthenticatedUser) {
    const paper = await this.load(id, actor);
    const { classroom, students } = await this.roll(query.classroomId ?? paper.classroomId);
    const sheets = await this.responseModel
      .find({ paperId: paper._id, deletedAt: null })
      .lean()
      .exec();
    const byStudent = new Map(sheets.map((sheet) => [String(sheet.studentId), sheet]));

    const rows = students.map((student) => {
      const sheet = byStudent.get(student.studentId);
      return {
        studentId: student.studentId,
        studentCode: student.studentCode,
        studentNameLo: student.studentNameLo,
        rollNumber: student.rollNumber,
        response: sheet
          ? {
              id: String(sheet._id),
              setLabel: sheet.setLabel,
              answers: sheet.answers,
              correctCount: sheet.correctCount,
              totalQuestions: sheet.totalQuestions,
              points: sheet.points ?? null,
              source: sheet.source,
              updatedAt: sheet.updatedAt,
            }
          : null,
      };
    });

    // Per original question: of the sheets marked, how many had it right.
    const correctByOriginal = paper.questions.map(() => 0);
    let marked = 0;
    for (const sheet of sheets) {
      const variant = paper.variants.find((candidate) => candidate.label === sheet.setLabel);
      if (!variant) continue;
      marked += 1;
      const graded = gradeSheet(
        variant,
        paper.questions.map((question) => question.correctIndex ?? null),
        sheet.answers,
        paper.totalPoints ?? null,
      );
      for (const question of graded.questions) {
        if (question.isCorrect) correctByOriginal[question.original] += 1;
      }
    }
    const scores = sheets.map((sheet) => sheet.correctCount);
    const points = sheets.map((sheet) => sheet.points).filter((p): p is number => p !== null);

    const semester = await this.semesterOf(paper);
    const subject = paper.subjectId as unknown as { _id: Types.ObjectId; nameLo: string } | null;

    return {
      classroom: { id: String(classroom._id), name: classroom.name },
      totalPoints: paper.totalPoints ?? null,
      // Where the points can go: the ກວດກາ column of one of this term's months.
      monthly: {
        subject: subject ? { id: String(subject._id), nameLo: subject.nameLo } : null,
        semester: semester
          ? { id: String(semester._id), nameLo: semester.nameLo, number: semester.number }
          : null,
        months: semester
          ? monthsForSemester(
              semester.number,
              await this.settings.getValue<Record<string, number[]>>('grading.semesterMonths'),
            )
          : [],
        testMax: COLUMN_MAX.test,
      },
      questionCount: paper.questions.length,
      optionLabelStyle: paper.optionLabelStyle,
      sets: paper.variants.map((variant) => variant.label),
      rows,
      summary: {
        marked,
        students: students.length,
        averageCorrect: average(scores),
        averagePoints: average(points),
        highestCorrect: scores.length ? Math.max(...scores) : null,
        lowestCorrect: scores.length ? Math.min(...scores) : null,
        questions: paper.questions.map((question, index) => ({
          original: index + 1,
          text: question.text,
          correct: correctByOriginal[index],
          hasAnswer: question.correctIndex !== null && question.correctIndex !== undefined,
        })),
      },
    };
  }

  /** One pupil's sheet as keyed in — marked on the spot, and kept. */
  async saveResponse(
    id: string,
    studentId: string,
    dto: SaveResponseDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<Record<string, unknown> & { graded: GradedQuestion[] }> {
    const paper = await this.load(id, actor);
    return this.writeResponse(paper, studentId, dto.setLabel, dto.answers, 'manual', actor, ip);
  }

  private async writeResponse(
    paper: ExamPaperDocument,
    studentId: string,
    set: string,
    rawAnswers: (number | null)[],
    source: 'manual' | 'scan',
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<Record<string, unknown> & { graded: GradedQuestion[] }> {
    const dto = { setLabel: set, answers: rawAnswers };
    const variant = paper.variants.find((candidate) => candidate.label === dto.setLabel);
    if (!variant) throw AppException.notFound('examPaper.unknownSet');

    const enrollment = await this.enrollmentModel
      // `studentId` is a Mixed path (see the schemas' ObjectId props), so a
      // string would match nothing: always an ObjectId in a query.
      .findOne({ studentId: new Types.ObjectId(studentId), status: 'active', deletedAt: null })
      .select('studentCode studentNameLo classroomId')
      .lean()
      .exec();
    if (!enrollment) throw AppException.notFound();

    const letters = OPTION_LETTERS[paper.optionLabelStyle].length;
    const answers = paper.questions.map((_, position) => {
      const value = dto.answers[position];
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < letters
        ? value
        : null;
    });
    const graded = gradeSheet(
      variant,
      paper.questions.map((question) => question.correctIndex ?? null),
      answers,
      paper.totalPoints ?? null,
    );

    const sheet = await this.responseModel
      .findOneAndUpdate(
        { paperId: paper._id, studentId: new Types.ObjectId(studentId), deletedAt: null },
        {
          $set: {
            studentCode: enrollment.studentCode,
            studentNameLo: enrollment.studentNameLo,
            classroomId: enrollment.classroomId,
            setLabel: dto.setLabel,
            answers,
            correctCount: graded.correctCount,
            totalQuestions: graded.totalQuestions,
            points: graded.points,
            source,
            recordedById: new Types.ObjectId(actor.sub),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'ExamResponse',
      entityId: sheet._id,
      newValue: {
        paperId: String(paper._id),
        studentId,
        set: dto.setLabel,
        correct: graded.correctCount,
      },
      ip,
    });

    return { ...(sheet.toJSON() as Record<string, unknown>), graded: graded.questions };
  }

  async deleteResponse(
    id: string,
    studentId: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<void> {
    const paper = await this.load(id, actor);
    const sheet = await this.responseModel
      .findOne({ paperId: paper._id, studentId: new Types.ObjectId(studentId), deletedAt: null })
      .exec();
    if (!sheet) throw AppException.notFound();
    sheet.deletedAt = new Date();
    sheet.deletedBy = new Types.ObjectId(actor.sub);
    await sheet.save();
    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'delete',
      entityType: 'ExamResponse',
      entityId: sheet._id,
      ip,
    });
  }

  /**
   * ສົ່ງຄະແນນເຂົ້າຄະແນນປະຈຳເດືອນ — every keyed sheet's points into the ກວດກາ
   * column of one month, through the monthly sheet's own save.
   *
   * Through that save and not around it: it is what checks the teacher is the
   * one assigned to the subject, refuses a submitted month without a reason,
   * flags the term result stale, and writes the audit row — a second path
   * into the marks would eventually skip one of those.
   */
  async pushToMonthlyMarks(
    id: string,
    dto: PushToMonthlyMarksDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const paper = await this.load(id, actor);
    const subject = paper.subjectId as unknown as { _id: Types.ObjectId } | null;
    if (!subject) throw AppException.badRequest('examPaper.subjectRequired');
    if ((paper.totalPoints ?? 0) > COLUMN_MAX.test) {
      throw AppException.badRequest('examPaper.pointsExceedTest', { max: COLUMN_MAX.test });
    }
    const classroomId =
      dto.classroomId ?? (paper.classroomId ? String(refIdOf(paper.classroomId)) : null);
    if (!classroomId) throw AppException.badRequest('examPaper.classroomRequired');
    const semester = await this.semesterOf(paper);
    if (!semester) throw AppException.notFound();

    const sheets = await this.responseModel
      .find({
        paperId: paper._id,
        classroomId: new Types.ObjectId(classroomId),
        deletedAt: null,
        points: { $ne: null },
      })
      .select('studentId points')
      .lean()
      .exec();
    if (sheets.length === 0) throw AppException.badRequest('examPaper.nothingToPush');

    return this.monthlyMarks.saveMonthGrid(
      {
        subjectId: String(subject._id),
        classroomId,
        semesterId: String(semester._id),
        month: dto.month,
        overrideReason: dto.overrideReason,
        entries: sheets.map((sheet) => ({
          studentId: String(sheet.studentId),
          test: Math.min(COLUMN_MAX.test, sheet.points ?? 0),
        })),
      },
      actor,
      ip,
    );
  }

  /** The paper's term, or the one running. */
  private async semesterOf(paper: ExamPaperDocument): Promise<SemesterDocument | null> {
    const ref = paper.semesterId as unknown as { _id?: Types.ObjectId } | Types.ObjectId | null;
    if (ref) {
      const semesterId = String(refIdOf(ref));
      return this.semesters.findOne(semesterId).catch(() => null);
    }
    return this.semesters.getActiveOrFail().catch(() => null);
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  /**
   * Reads a batch of photographed sheets and files each as a scan to review.
   *
   * Nothing is marked here. The reader proposes — who, which set, which
   * bubbles — and the proposal waits for the teacher, because a photograph
   * of a classroom's worth of pen marks is not evidence a computer should
   * act on alone. A photo the reader cannot make sense of is filed as
   * `failed` with its reason, rather than dropped, so the teacher knows
   * which pupil's sheet to photograph again.
   */
  async uploadScans(
    id: string,
    files: Express.Multer.File[],
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const paper = await this.load(id, actor);
    if (paper.variants.length === 0) throw AppException.badRequest('examPaper.noVariants');
    const layout = this.layoutOf(paper);
    const prefix = `exam-papers/${paper._id.toHexString()}/scans`;
    const created: ExamScanDocument[] = [];

    for (const file of files) {
      const { result, jpeg } = await readAnswerSheet(file.buffer, layout);
      const imageKey = `${prefix}/${randomUUID()}.jpg`;
      await this.storage.putBuffer(imageKey, jpeg ?? file.buffer, 'image/jpeg');

      if (!result.ok) {
        created.push(
          await this.scanModel.create({
            paperId: paper._id,
            imageKey,
            filename: uploadedName(file),
            image: result.image ?? null,
            status: 'failed',
            failure: result.reason,
            uploadedById: new Types.ObjectId(actor.sub),
          }),
        );
        continue;
      }

      const pupil = await this.identifyPupil(paper, result.qr, result.codeFromBubbles);
      const set =
        (result.qr?.paperId === String(paper._id) ? result.qr.set : null) ??
        (result.setFromBubbles !== null
          ? (paper.variants[result.setFromBubbles]?.label ?? null)
          : null);

      created.push(
        await this.scanModel.create({
          paperId: paper._id,
          imageKey,
          filename: uploadedName(file),
          image: result.image,
          status: 'pending',
          studentId: pupil ? new Types.ObjectId(pupil.studentId) : null,
          studentCode: pupil?.studentCode ?? result.codeFromBubbles ?? null,
          studentNameLo: pupil?.studentNameLo ?? null,
          setLabel: set,
          qr: result.qr,
          codeFromBubbles: result.codeFromBubbles,
          setFromBubbles: result.setFromBubbles,
          answers: result.questions.map((question) => question.marked),
          questions: result.questions,
          corners: result.corners,
          contrast: result.contrast,
          uploadedById: new Types.ObjectId(actor.sub),
        }),
      );
    }

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'create',
      entityType: 'ExamScan',
      entityId: paper._id,
      newValue: {
        paperId: String(paper._id),
        uploaded: files.length,
        failed: created.filter((scan) => scan.status === 'failed').length,
      },
      ip,
    });

    return Promise.all(created.map((scan) => this.scanView(scan)));
  }

  async scans(id: string, query: ScansQueryDto, actor: AuthenticatedUser) {
    const paper = await this.load(id, actor);
    const filter: FilterQuery<ExamScanDocument> = { paperId: paper._id, deletedAt: null };
    if (query.status) filter.status = query.status;
    const rows = await this.scanModel.find(filter).sort({ createdAt: -1 }).limit(300).exec();
    return Promise.all(rows.map((scan) => this.scanView(scan)));
  }

  /**
   * The teacher's corrections to a scan, and — with `confirm` — the moment
   * it becomes the pupil's response. Confirming twice is refused: a mark
   * written from a photograph is corrected on the response, not by
   * re-reading the photograph.
   */
  async updateScan(
    id: string,
    scanId: string,
    dto: UpdateScanDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    const paper = await this.load(id, actor);
    const scan = await this.scanModel
      .findOne({ _id: scanId, paperId: paper._id, deletedAt: null })
      .exec();
    if (!scan) throw AppException.notFound();
    if (scan.status === 'confirmed')
      throw AppException.badRequest('examPaper.scanAlreadyConfirmed');

    if (dto.studentId !== undefined) {
      if (dto.studentId) {
        const enrollment = await this.enrollmentModel
          .findOne({
            studentId: new Types.ObjectId(dto.studentId),
            status: 'active',
            deletedAt: null,
          })
          .select('studentCode studentNameLo')
          .lean()
          .exec();
        if (!enrollment) throw AppException.notFound();
        scan.studentId = new Types.ObjectId(dto.studentId);
        scan.studentCode = enrollment.studentCode;
        scan.studentNameLo = enrollment.studentNameLo;
      } else {
        scan.studentId = null;
        scan.studentNameLo = null;
      }
    }
    if (dto.setLabel !== undefined) scan.setLabel = dto.setLabel;
    if (dto.answers !== undefined) {
      const letters = OPTION_LETTERS[paper.optionLabelStyle].length;
      scan.answers = paper.questions.map((_, position) => {
        const value = dto.answers?.[position];
        return typeof value === 'number' && value >= 0 && value < letters ? value : null;
      });
    }

    if (dto.confirm) {
      if (!scan.studentId || !scan.setLabel) {
        throw AppException.badRequest('examPaper.scanNeedsStudent');
      }
      const response = await this.writeResponse(
        paper,
        String(scan.studentId),
        scan.setLabel,
        scan.answers,
        'scan',
        actor,
        ip,
      );
      scan.responseId = new Types.ObjectId(String(response.id));
      scan.status = 'confirmed';
      scan.confirmedAt = new Date();
    }

    await scan.save();
    return this.scanView(scan);
  }

  async deleteScan(id: string, scanId: string, actor: AuthenticatedUser): Promise<void> {
    const paper = await this.load(id, actor);
    const scan = await this.scanModel
      .findOne({ _id: scanId, paperId: paper._id, deletedAt: null })
      .exec();
    if (!scan) throw AppException.notFound();
    scan.deletedAt = new Date();
    scan.deletedBy = new Types.ObjectId(actor.sub);
    await scan.save();
  }

  /** The sheet's geometry for this paper — the same call the printer makes. */
  private layoutOf(paper: ExamPaperDocument) {
    return answerSheetLayout({
      questionCount: paper.questions.length,
      optionCount: Math.min(
        8,
        Math.max(4, ...paper.questions.map((question) => question.options.length)),
      ),
      codeDigits: MIN_CODE_DIGITS,
      setCount: paper.variants.length,
    });
  }

  /**
   * Who the sheet belongs to: the QR's pupil when the QR is this paper's,
   * else the code the pupil filled, looked up on the roll of the paper's
   * class first and the whole school second.
   */
  private async identifyPupil(
    paper: ExamPaperDocument,
    qr: { paperId: string; set: string | null; studentId: string | null } | null,
    code: string | null,
  ): Promise<{ studentId: string; studentCode: string; studentNameLo: string } | null> {
    const pick = (
      row: { studentId: unknown; studentCode: string; studentNameLo: string } | null,
    ) =>
      row
        ? {
            studentId: String(row.studentId),
            studentCode: row.studentCode,
            studentNameLo: row.studentNameLo,
          }
        : null;

    // A QR from somebody else's printer could say anything; only a valid id is looked up.
    if (qr?.studentId && qr.paperId === String(paper._id) && Types.ObjectId.isValid(qr.studentId)) {
      const row = await this.enrollmentModel
        .findOne({
          studentId: new Types.ObjectId(qr.studentId),
          status: 'active',
          deletedAt: null,
        })
        .select('studentId studentCode studentNameLo')
        .lean()
        .exec();
      if (row) return pick(row);
    }
    if (!code) return null;
    const classroomId = paper.classroomId ? refIdOf(paper.classroomId) : null;
    const filter = {
      status: 'active',
      deletedAt: null,
      studentCode: code.replace(/^0+(?=\d)/, ''),
    };
    const padded = { ...filter, studentCode: code };
    for (const candidate of [
      classroomId ? { ...padded, classroomId } : null,
      padded,
      classroomId ? { ...filter, classroomId } : null,
      filter,
    ]) {
      if (!candidate) continue;
      const row = await this.enrollmentModel
        .findOne(candidate)
        .select('studentId studentCode studentNameLo')
        .lean()
        .exec();
      if (row) return pick(row);
    }
    return null;
  }

  private async scanView(scan: ExamScanDocument) {
    return {
      ...(scan.toJSON() as Record<string, unknown>),
      imageUrl: await this.storage.getSignedUrl(scan.imageKey),
    };
  }

  /** Re-marks every sheet of the paper from its stored answers. */
  private async regradeAll(paper: ExamPaperDocument): Promise<void> {
    const sheets = await this.responseModel.find({ paperId: paper._id, deletedAt: null }).exec();
    const key = paper.questions.map((question) => question.correctIndex ?? null);
    for (const sheet of sheets) {
      const variant = paper.variants.find((candidate) => candidate.label === sheet.setLabel);
      if (!variant) continue;
      const answers = paper.questions.map((_, position) => sheet.answers[position] ?? null);
      const graded = gradeSheet(variant, key, answers, paper.totalPoints ?? null);
      sheet.answers = answers;
      sheet.correctCount = graded.correctCount;
      sheet.totalQuestions = graded.totalQuestions;
      sheet.points = graded.points;
      await sheet.save();
    }
  }

  // ── Visibility ────────────────────────────────────────────────────────────

  private async load(id: string, actor: AuthenticatedUser): Promise<ExamPaperDocument> {
    const paper = await this.model.findOne({ _id: id, deletedAt: null }).populate(POPULATE).exec();
    if (!paper) throw AppException.notFound();
    if (!this.managesAll(actor) && !refEquals(paper.createdById, actor.sub)) {
      throw AppException.forbidden('examPaper.notTheOwner');
    }
    return paper;
  }

  private applyVisibility(filter: FilterQuery<ExamPaperDocument>, actor: AuthenticatedUser): void {
    if (this.managesAll(actor)) return;
    filter.createdById = new Types.ObjectId(actor.sub);
  }

  private managesAll(actor: AuthenticatedUser): boolean {
    return actor.permissions.some(
      (permission) =>
        permission.resource === 'exam-papers' && permission.actions.includes('manage'),
    );
  }
}

/** The id behind a reference, populated or not. */
function refIdOf(ref: unknown): Types.ObjectId | string {
  if (ref instanceof Types.ObjectId) return ref;
  if (typeof ref === 'object' && ref !== null && '_id' in ref) {
    return (ref as { _id: Types.ObjectId })._id;
  }
  return String(ref);
}

/** A populated or bare reference against a user id. */
function refEquals(ref: unknown, userId: string): boolean {
  if (!ref) return false;
  const id =
    ref instanceof Types.ObjectId
      ? ref
      : typeof ref === 'object' && ref !== null && '_id' in ref
        ? (ref as { _id: Types.ObjectId })._id
        : ref;
  return String(id) === userId;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The name the teacher's file had. Multer reads the multipart header as
 * Latin-1, so a Lao name arrives as mojibake unless it is read again as UTF-8.
 */
function uploadedName(file: Express.Multer.File): string {
  const name = file.originalname ?? '';
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

/**
 * A title as a file name. Blocklist, not allowlist: an allowlist of letters
 * eats Lao vowel signs and tone marks, which are marks, not letters.
 */
function fileSafe(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'exam';
}
