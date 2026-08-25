import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { nicknameOf, populatedStudent, STUDENT_NAME_SELECT } from 'src/common/utils/student-name';
import {
  Enrollment,
  EnrollmentDocument,
  MonthlyMark,
  MonthlyMarkDocument,
  Semester,
  SemesterDocument,
  Subject,
  SubjectDocument,
  SubjectTermMark,
  SubjectTermMarkDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import { TeachingAssignmentsService } from '../teaching-assignments/teaching-assignments.service';
import { TermResultStalenessService } from '../term-results/term-result-staleness.service';
import {
  AnnualSheetQueryDto,
  LockMonthDto,
  MonthGridQueryDto,
  SaveMarksResultDto,
  SaveMonthGridDto,
  SaveTermMarksDto,
  SheetQueryDto,
} from './dto/monthly-mark.dto';
import {
  annualScore,
  COLUMN_MAX,
  EMPTY_CELLS,
  isPassing,
  MONTHLY_COLUMNS,
  monthScore,
  monthsForSemester,
  monthTotal,
  semesterScore,
  threeMonthAverage,
  type MonthCells,
  type MonthlyColumn,
} from './monthly-grading';

/** One row of the form for a student, in one strand of one month. */
export interface StrandCell {
  /** `null` for a subject marked as a whole. */
  strand: string | null;
  cells: MonthCells;
  /** ລວມ, out of 10 — `null` while nothing has been written. */
  total: number | null;
  isLocked: boolean;
}

export interface SheetMonth {
  month: number;
  strands: StrandCell[];
  /** ສະເລ່ຍ across the strands, or the single total for an ordinary subject. */
  score: number | null;
  isComplete: boolean;
}

export interface SheetRow {
  studentId: string;
  studentCode: string;
  studentNameLo: string;
  studentNickname: string | null;
  rollNumber: number | null;
  /** False for a student who has left; the school keeps them on the sheet. */
  isEnrolled: boolean;
  months: SheetMonth[];
  threeMonth: number | null;
  threeMonthComplete: boolean;
  examScore: number | null;
  bonus: number | null;
  /** ພາກຮຽນ — `null` until both the months and the exam are in. */
  semesterMark: number | null;
  isPassing: boolean | null;
}

/** One subject's term outcome for one student, as the term result reads it. */
export interface MonthlySubjectMark {
  subjectId: string;
  monthScores: { month: number; score: number | null }[];
  threeMonth: number | null;
  threeMonthComplete: boolean;
  examScore: number | null;
  bonus: number | null;
  /** ພາກຮຽນ — `null` until the months and the exam are both in. */
  mark: number | null;
  isComplete: boolean;
}

@Injectable()
export class MonthlyMarksService {
  constructor(
    @InjectModel(MonthlyMark.name) private readonly model: Model<MonthlyMarkDocument>,
    @InjectModel(SubjectTermMark.name)
    private readonly termModel: Model<SubjectTermMarkDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    private readonly semesters: SemestersService,
    private readonly classrooms: ClassroomsService,
    private readonly assignments: TeachingAssignmentsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogsService,
    private readonly staleness: TermResultStalenessService,
  ) {}

  /**
   * The entry form: one month of one subject for one class.
   *
   * Every student on the class list comes back whether or not they have been
   * marked, because the form is filled in against the roll — a student missing
   * from the grid is a student who silently never gets a mark.
   */
  async getMonthGrid(query: MonthGridQueryDto, actor: AuthenticatedUser) {
    const { subject, classroom, semester } = await this.resolveContext(query);
    const strands = this.strandsOf(subject);
    // The form carries the term's month list so the picker above it does not
    // have to keep its own copy of which months the school collects.
    const months = await this.monthsFor(semester.number);

    const roster = await this.loadRoster(classroom._id, subject._id, semester._id);
    const marks = await this.model
      .find({
        subjectId: subject._id,
        classroomId: classroom._id,
        semesterId: semester._id,
        month: query.month,
        deletedAt: null,
      })
      .lean()
      .exec();

    const byKey = new Map(marks.map((mark) => [cellKey(mark.studentId, mark.strand), mark]));

    return {
      subject: this.subjectView(subject, strands),
      classroom: this.classroomView(classroom),
      semester: this.semesterView(semester),
      months,
      month: query.month,
      columnMax: COLUMN_MAX,
      canEdit: await this.canEdit(actor, subject._id, classroom._id, semester._id),
      rows: roster.map((student) => ({
        ...student,
        strands: strands.map((strand) =>
          this.strandCell(
            byKey.get(cellKey(new Types.ObjectId(student.studentId), strand)),
            strand,
          ),
        ),
      })),
    };
  }

  /**
   * Saves one month of the grid.
   *
   * A cell that is not sent keeps what it had; a cell sent as `null` is cleared
   * back to unmarked. A row left blank on every column is removed rather than
   * stored as four nulls, so "nothing written" has exactly one representation.
   */
  async saveMonthGrid(
    dto: SaveMonthGridDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<SaveMarksResultDto> {
    const { subject, classroom, semester } = await this.resolveContext(dto);
    await this.semesters.getWritableOrFail(semester._id.toString());
    await this.assertCanEdit(actor, subject._id, classroom._id, semester._id);

    const strand = this.resolveStrand(subject, dto.strand);
    const enrolled = await this.enrolledIds(classroom._id);

    const result: SaveMarksResultDto = { saved: 0, skipped: 0, errors: [] };
    const touched: string[] = [];

    for (const entry of dto.entries) {
      try {
        if (!enrolled.has(entry.studentId)) {
          throw AppException.badRequest('score.studentNotInClassroom', {
            studentId: entry.studentId,
          });
        }

        const patch: Partial<Record<MonthlyColumn, number | null>> = {};
        for (const column of MONTHLY_COLUMNS) {
          if (!(column in entry)) continue;
          const value = entry[column] ?? null;
          if (value !== null && (value < 0 || value > COLUMN_MAX[column])) {
            throw AppException.badRequest('score.exceedsMax', {
              column,
              value,
              maxScore: COLUMN_MAX[column],
            });
          }
          patch[column] = value;
        }
        if (Object.keys(patch).length === 0) {
          result.skipped += 1;
          continue;
        }

        await this.saveOneCell(
          { ...dto, strand },
          entry.studentId,
          patch,
          { subject, classroom, semester },
          actor,
          ip,
        );
        result.saved += 1;
        touched.push(entry.studentId);
      } catch (error) {
        result.skipped += 1;
        result.errors.push({ studentId: entry.studentId, reason: reasonOf(error) });
      }
    }

    // The term result was computed from the marks that just moved, so it is now
    // out of date and says so until the office recomputes it.
    if (touched.length > 0) {
      await this.staleness.markStale(
        { studentIds: touched, classroomId: classroom._id, semesterId: semester._id },
        `monthly marks saved for ${subject.nameLo}, month ${dto.month}`,
      );
    }

    return result;
  }

  /**
   * The whole term as the paper sheet lays it out: three months, their average,
   * the exam, the bonus, and the term mark.
   *
   * Students who have left the class are kept on it — the school records their
   * remaining months as zero rather than dropping them, and a sheet that lost
   * them would not reconcile with the paper it replaces.
   */
  async getSemesterSheet(query: SheetQueryDto, actor: AuthenticatedUser) {
    const { subject, classroom, semester } = await this.resolveContext(query);
    const strands = this.strandsOf(subject);
    const months = await this.monthsFor(semester.number);

    const [roster, marks, termMarks] = await Promise.all([
      this.loadRoster(classroom._id, subject._id, semester._id),
      this.model
        .find({
          subjectId: subject._id,
          classroomId: classroom._id,
          semesterId: semester._id,
          deletedAt: null,
        })
        .lean()
        .exec(),
      this.termModel
        .find({
          subjectId: subject._id,
          classroomId: classroom._id,
          semesterId: semester._id,
          deletedAt: null,
        })
        .lean()
        .exec(),
    ]);

    const byKey = new Map(
      marks.map((mark) => [
        `${mark.studentId.toString()}|${mark.month}|${mark.strand ?? ''}`,
        mark,
      ]),
    );
    const termByStudent = new Map(termMarks.map((mark) => [mark.studentId.toString(), mark]));

    const rows: SheetRow[] = roster.map((student) => {
      const sheetMonths: SheetMonth[] = months.map((month) => {
        const cells = strands.map((strand) =>
          this.strandCell(byKey.get(`${student.studentId}|${month}|${strand ?? ''}`), strand),
        );
        const score = monthScore(
          cells.map((cell) => cell.total),
          strands.length,
        );
        return { month, strands: cells, score: score.value, isComplete: score.isComplete };
      });

      const threeMonth = threeMonthAverage(
        sheetMonths.map((month) => month.score),
        months.length,
      );
      const term = termByStudent.get(student.studentId);
      const mark = semesterScore(threeMonth.value, term?.examScore ?? null, term?.bonus ?? null);

      return {
        ...student,
        months: sheetMonths,
        threeMonth: threeMonth.value,
        threeMonthComplete: threeMonth.isComplete,
        examScore: term?.examScore ?? null,
        bonus: term?.bonus ?? null,
        semesterMark: mark.value,
        isPassing: isPassing(mark.value),
      };
    });

    return {
      subject: this.subjectView(subject, strands),
      classroom: this.classroomView(classroom),
      semester: this.semesterView(semester),
      months,
      columnMax: COLUMN_MAX,
      canEdit: await this.canEdit(actor, subject._id, classroom._id, semester._id),
      rows,
      summary: summarize(rows),
    };
  }

  /** ສອບເສັງພາກ and ເພີ່ມ for a class, saved as one sheet. */
  async saveTermMarks(
    dto: SaveTermMarksDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<SaveMarksResultDto> {
    const { subject, classroom, semester } = await this.resolveContext(dto);
    await this.semesters.getWritableOrFail(semester._id.toString());
    await this.assertCanEdit(actor, subject._id, classroom._id, semester._id);

    const enrolled = await this.enrolledIds(classroom._id);
    const result: SaveMarksResultDto = { saved: 0, skipped: 0, errors: [] };
    const touched: string[] = [];

    for (const entry of dto.entries) {
      try {
        if (!enrolled.has(entry.studentId)) {
          throw AppException.badRequest('score.studentNotInClassroom', {
            studentId: entry.studentId,
          });
        }

        const patch: Record<string, number | null> = {};
        if ('examScore' in entry) patch.examScore = entry.examScore ?? null;
        if ('bonus' in entry) patch.bonus = entry.bonus ?? null;
        if (Object.keys(patch).length === 0) {
          result.skipped += 1;
          continue;
        }

        const existing = await this.termModel
          .findOne({
            studentId: new Types.ObjectId(entry.studentId),
            subjectId: subject._id,
            semesterId: semester._id,
            deletedAt: null,
          })
          .exec();

        if (existing?.isLocked && !dto.overrideReason) {
          throw AppException.conflict('score.overrideReasonRequired');
        }

        await this.termModel
          .updateOne(
            {
              studentId: new Types.ObjectId(entry.studentId),
              subjectId: subject._id,
              semesterId: semester._id,
              deletedAt: null,
            },
            {
              $set: {
                ...patch,
                classroomId: classroom._id,
                schoolYearId: semester.schoolYearId,
                recordedBy: new Types.ObjectId(actor.sub),
              },
              $setOnInsert: { isLocked: false },
            },
            { upsert: true },
          )
          .exec();

        await this.audit.record({
          action: existing ? 'update' : 'create',
          entityType: 'subjectTermMarks',
          entityId: existing?._id,
          userId: actor.sub,
          username: actor.username,
          oldValue: existing ? { examScore: existing.examScore, bonus: existing.bonus } : undefined,
          newValue: { studentId: entry.studentId, subjectId: subject._id.toString(), ...patch },
          ip,
          reason: existing?.isLocked ? `POST-LOCK AMENDMENT: ${dto.overrideReason}` : null,
        });

        result.saved += 1;
        touched.push(entry.studentId);
      } catch (error) {
        result.skipped += 1;
        result.errors.push({ studentId: entry.studentId, reason: reasonOf(error) });
      }
    }

    // The exam is half the term mark, so a change here moves the stored result
    // as surely as a month does.
    if (touched.length > 0) {
      await this.staleness.markStale(
        { studentIds: touched, classroomId: classroom._id, semesterId: semester._id },
        `exam or bonus saved for ${subject.nameLo}`,
      );
    }

    return result;
  }

  /**
   * ໝົດປີ — both terms of one subject for one class, and their mean.
   *
   * Read from the same rows as the term sheets rather than from a stored annual
   * figure: the year is a view of the two terms, and a copy of it would be one
   * more thing to recompute whenever a mark is corrected.
   */
  async getAnnualSheet(query: AnnualSheetQueryDto, actor: AuthenticatedUser) {
    const subject = await this.subjectModel.findById(query.subjectId).lean().exec();
    if (!subject) throw AppException.notFound();

    const classroom = await this.classrooms.findOnePopulated(query.classroomId);
    const schoolYearId = query.schoolYearId
      ? new Types.ObjectId(query.schoolYearId)
      : (await this.semesters.getActiveOrFail()).schoolYearId;

    // Read straight off the model: this needs the year's terms in order, which
    // the paginated list endpoint would only give back wrapped in a page.
    const terms = await this.semesterModel
      .find({ schoolYearId, deletedAt: null })
      .sort({ number: 1 })
      .lean()
      .exec();

    const sheets = await Promise.all(
      terms.map((term) =>
        this.getSemesterSheet(
          {
            subjectId: query.subjectId,
            classroomId: query.classroomId,
            semesterId: term._id.toString(),
          },
          actor,
        ),
      ),
    );

    const byStudent = new Map<
      string,
      {
        studentCode: string;
        studentNameLo: string;
        studentNickname: string | null;
        rollNumber: number | null;
        isEnrolled: boolean;
        marks: (number | null)[];
      }
    >();
    sheets.forEach((sheet, index) => {
      for (const row of sheet.rows) {
        const entry = byStudent.get(row.studentId) ?? {
          studentCode: row.studentCode,
          studentNameLo: row.studentNameLo,
          studentNickname: row.studentNickname,
          rollNumber: row.rollNumber,
          isEnrolled: row.isEnrolled,
          marks: terms.map(() => null),
        };
        entry.marks[index] = row.semesterMark;
        byStudent.set(row.studentId, entry);
      }
    });

    const rows = [...byStudent.entries()].map(([studentId, entry]) => {
      const annual = annualScore(entry.marks[0] ?? null, entry.marks[1] ?? null);
      return {
        studentId,
        studentCode: entry.studentCode,
        studentNameLo: entry.studentNameLo,
        studentNickname: entry.studentNickname,
        rollNumber: entry.rollNumber,
        isEnrolled: entry.isEnrolled,
        semesterMarks: entry.marks,
        annual: annual.value,
        isPassing: isPassing(annual.value),
      };
    });

    rows.sort((a, b) => (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999));

    return {
      subject: this.subjectView(
        subject as SubjectDocument,
        this.strandsOf(subject as SubjectDocument),
      ),
      classroom: this.classroomView(classroom),
      semesters: terms.map((term) => this.semesterView(term)),
      rows,
    };
  }

  /** Submits a month, or reopens one. Reopening needs a reason and is audited. */
  async setMonthLock(
    dto: LockMonthDto,
    locked: boolean,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ affected: number }> {
    const { subject, classroom, semester } = await this.resolveContext(dto);
    await this.assertCanEdit(actor, subject._id, classroom._id, semester._id);

    if (!locked && !dto.reason) {
      throw AppException.conflict('score.overrideReasonRequired');
    }

    const filter = {
      subjectId: subject._id,
      classroomId: classroom._id,
      semesterId: semester._id,
      month: dto.month,
      deletedAt: null,
      ...(dto.strand ? { strand: dto.strand } : {}),
    };

    const outcome = await this.model
      .updateMany(filter, {
        $set: {
          isLocked: locked,
          lockedAt: locked ? new Date() : null,
          lockedBy: locked ? new Types.ObjectId(actor.sub) : null,
        },
      })
      .exec();

    await this.audit.record({
      action: locked ? 'lock' : 'unlock',
      entityType: 'monthlyMarks',
      userId: actor.sub,
      username: actor.username,
      newValue: {
        subjectId: subject._id.toString(),
        classroomId: classroom._id.toString(),
        month: dto.month,
        strand: dto.strand ?? null,
        affected: outcome.modifiedCount,
      },
      ip,
      reason: dto.reason ?? null,
    });

    return { affected: outcome.modifiedCount };
  }

  /**
   * Every subject's ພາກຮຽນ for a whole class, keyed by student.
   *
   * The one read the term result needs: it computes a class at a time, and
   * fetching a sheet per student per subject would be one query per cell of the
   * report. Two queries cover the class — the months and the exams — and the
   * derivation is the same code the sheet on screen is drawn from, so a mark
   * cannot mean one thing in the register and another on the report card.
   */
  async getClassroomSubjectMarks(
    classroomId: string,
    semesterId: string,
  ): Promise<Map<string, MonthlySubjectMark[]>> {
    const semester = await this.semesters.findOne(semesterId);
    const months = await this.monthsFor(semester.number);

    const [marks, termMarks] = await Promise.all([
      this.model
        .find({
          classroomId: new Types.ObjectId(classroomId),
          semesterId: semester._id,
          deletedAt: null,
        })
        .lean()
        .exec(),
      this.termModel
        .find({
          classroomId: new Types.ObjectId(classroomId),
          semesterId: semester._id,
          deletedAt: null,
        })
        .lean()
        .exec(),
    ]);

    if (marks.length === 0 && termMarks.length === 0) return new Map();

    // Only the subjects that actually appear, and only for their strands.
    const subjectIds = [
      ...new Set([
        ...marks.map((mark) => mark.subjectId.toString()),
        ...termMarks.map((mark) => mark.subjectId.toString()),
      ]),
    ];
    const subjects = await this.subjectModel
      .find({ _id: { $in: subjectIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const strandsBySubject = new Map(
      subjects.map((subject) => [
        subject._id.toString(),
        this.strandsOf(subject as SubjectDocument),
      ]),
    );

    /** studentId → subjectId → month → strand → cells. */
    const cells = new Map<string, Map<string, Map<number, Map<string, MonthCells>>>>();
    for (const mark of marks) {
      const student = mark.studentId.toString();
      const subject = mark.subjectId.toString();
      const byStudent = cells.get(student) ?? new Map();
      const bySubject = byStudent.get(subject) ?? new Map();
      const byMonth = bySubject.get(mark.month) ?? new Map();

      byMonth.set(mark.strand ?? '', {
        attendance: mark.attendance ?? null,
        notebook: mark.notebook ?? null,
        activity: mark.activity ?? null,
        test: mark.test ?? null,
      });
      bySubject.set(mark.month, byMonth);
      byStudent.set(subject, bySubject);
      cells.set(student, byStudent);
    }

    const termByKey = new Map(
      termMarks.map((mark) => [`${mark.studentId.toString()}|${mark.subjectId.toString()}`, mark]),
    );
    // A student whose only record is an exam mark still owes a row, so the term
    // keys seed the map alongside the monthly ones.
    for (const [key] of termByKey) {
      const [student, subject] = key.split('|');
      const byStudent = cells.get(student) ?? new Map();
      if (!byStudent.has(subject)) byStudent.set(subject, new Map());
      cells.set(student, byStudent);
    }

    const result = new Map<string, MonthlySubjectMark[]>();
    for (const [student, bySubject] of cells) {
      const rows: MonthlySubjectMark[] = [];

      for (const [subjectId, byMonth] of bySubject) {
        const strands = strandsBySubject.get(subjectId) ?? [null];

        const monthScores = months.map((month) => {
          const written = byMonth.get(month);
          const totals = strands.map((strand) =>
            written ? monthTotal(written.get(strand ?? '') ?? EMPTY_CELLS) : null,
          );
          return { month, score: monthScore(totals, strands.length).value };
        });

        const threeMonth = threeMonthAverage(
          monthScores.map((entry) => entry.score),
          months.length,
        );
        const term = termByKey.get(`${student}|${subjectId}`);
        const mark = semesterScore(threeMonth.value, term?.examScore ?? null, term?.bonus ?? null);

        rows.push({
          subjectId,
          monthScores,
          threeMonth: threeMonth.value,
          threeMonthComplete: threeMonth.isComplete,
          examScore: term?.examScore ?? null,
          bonus: term?.bonus ?? null,
          mark: mark.value,
          // Complete means every month is in *and* the exam has been sat: the
          // term mark is half the exam, so a missing one is not a detail.
          isComplete: threeMonth.isComplete && mark.isComplete,
        });
      }

      result.set(student, rows);
    }

    return result;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Subject, class and term resolved together, so every read agrees on them. */
  private async resolveContext(query: SheetQueryDto) {
    const [subject, classroom, semester] = await Promise.all([
      this.subjectModel.findOne({ _id: query.subjectId, deletedAt: null }).exec(),
      this.classrooms.findOnePopulated(query.classroomId),
      query.semesterId
        ? this.semesters.findOne(query.semesterId)
        : this.semesters.getActiveOrFail(),
    ]);
    if (!subject) throw AppException.notFound();

    return { subject, classroom, semester };
  }

  /** `[null]` for an ordinary subject — one unnamed strand, one row a month. */
  private strandsOf(subject: SubjectDocument): (string | null)[] {
    const declared = subject.strands ?? [];
    return declared.length > 0 ? [...declared] : [null];
  }

  /** Refuses a strand the subject does not declare, and vice versa. */
  private resolveStrand(subject: SubjectDocument, requested: string | undefined): string | null {
    const declared = subject.strands ?? [];
    if (declared.length === 0) return null;

    if (!requested || !declared.includes(requested)) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'strand',
        reason: `subject is marked in strands: ${declared.join(', ')}`,
      });
    }
    return requested;
  }

  private async monthsFor(semesterNumber: number): Promise<number[]> {
    const configured =
      await this.settings.getValue<Record<string, number[]>>('grading.semesterMonths');
    return monthsForSemester(semesterNumber, configured);
  }

  /**
   * The class list the sheet is drawn against.
   *
   * Active enrolments, plus anyone who has left but has marks on this subject —
   * the school keeps a leaver's row and records zeros against it, and a sheet
   * that dropped them would lose marks already earned.
   */
  private async loadRoster(
    classroomId: Types.ObjectId,
    subjectId: Types.ObjectId,
    semesterId: Types.ObjectId,
  ) {
    const [enrollments, markedIds] = await Promise.all([
      this.enrollmentModel
        .find({ classroomId, deletedAt: null })
        .populate('studentId', STUDENT_NAME_SELECT)
        .sort({ rollNumber: 1 })
        .lean()
        .exec(),
      this.model.distinct('studentId', { subjectId, classroomId, semesterId, deletedAt: null }),
    ]);

    const marked = new Set(markedIds.map((id) => id.toString()));

    return enrollments
      .filter(
        (enrollment) =>
          enrollment.status === 'active' || marked.has(enrollment.studentId.toString()),
      )
      .map((enrollment) => {
        const student = populatedStudent(enrollment.studentId);
        return {
          studentId: student?._id.toString() ?? String(enrollment.studentId),
          studentCode: enrollment.studentCode,
          studentNameLo: enrollment.studentNameLo,
          studentNickname: nicknameOf(student),
          rollNumber: enrollment.rollNumber ?? null,
          isEnrolled: enrollment.status === 'active',
        };
      });
  }

  private async enrolledIds(classroomId: Types.ObjectId): Promise<Set<string>> {
    const roster = await this.enrollmentModel
      .find({ classroomId, status: 'active', deletedAt: null })
      .select('studentId')
      .lean()
      .exec();
    return new Set(roster.map((row) => row.studentId.toString()));
  }

  private strandCell(
    mark: Pick<MonthlyMark, MonthlyColumn | 'isLocked'> | undefined,
    strand: string | null,
  ): StrandCell {
    if (!mark) return { strand, cells: EMPTY_CELLS, total: null, isLocked: false };

    const cells: MonthCells = {
      attendance: mark.attendance ?? null,
      notebook: mark.notebook ?? null,
      activity: mark.activity ?? null,
      test: mark.test ?? null,
    };
    return { strand, cells, total: monthTotal(cells), isLocked: mark.isLocked };
  }

  /**
   * Writes one cell of the grid.
   *
   * A row whose every column ends up blank is soft-deleted rather than kept as
   * four nulls: the coverage of a month is counted from the rows that exist, so
   * an empty row would read as work that had been done.
   */
  private async saveOneCell(
    target: { month: number; strand: string | null; overrideReason?: string },
    studentId: string,
    patch: Partial<Record<MonthlyColumn, number | null>>,
    context: {
      subject: SubjectDocument;
      classroom: { _id: Types.ObjectId };
      semester: { _id: Types.ObjectId; schoolYearId: Types.ObjectId };
    },
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<void> {
    const key = {
      studentId: new Types.ObjectId(studentId),
      subjectId: context.subject._id,
      semesterId: context.semester._id,
      month: target.month,
      strand: target.strand,
      deletedAt: null,
    };

    const existing = await this.model.findOne(key).exec();
    if (existing?.isLocked && !target.overrideReason) {
      throw AppException.conflict('score.overrideReasonRequired');
    }

    const next: MonthCells = {
      attendance: pick(patch, existing, 'attendance'),
      notebook: pick(patch, existing, 'notebook'),
      activity: pick(patch, existing, 'activity'),
      test: pick(patch, existing, 'test'),
    };

    const before = existing
      ? {
          attendance: existing.attendance ?? null,
          notebook: existing.notebook ?? null,
          activity: existing.activity ?? null,
          test: existing.test ?? null,
        }
      : null;

    if (before && MONTHLY_COLUMNS.every((column) => before[column] === next[column])) return;

    const isBlank = MONTHLY_COLUMNS.every((column) => next[column] === null);

    if (isBlank) {
      if (!existing) return;
      await this.model
        .updateOne(
          { _id: existing._id },
          { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(actor.sub) } },
        )
        .exec();
    } else {
      await this.model
        .updateOne(
          key,
          {
            $set: {
              ...next,
              classroomId: context.classroom._id,
              schoolYearId: context.semester.schoolYearId,
              recordedBy: new Types.ObjectId(actor.sub),
            },
            $setOnInsert: { isLocked: false },
          },
          { upsert: true },
        )
        .exec();
    }

    await this.audit.record({
      action: isBlank ? 'delete' : existing ? 'update' : 'create',
      entityType: 'monthlyMarks',
      entityId: existing?._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: before ?? undefined,
      newValue: {
        studentId,
        subjectId: context.subject._id.toString(),
        month: target.month,
        strand: target.strand,
        ...next,
      },
      ip,
      reason: existing?.isLocked ? `POST-LOCK AMENDMENT: ${target.overrideReason}` : null,
    });
  }

  /**
   * Only the teacher the timetable names may mark a class.
   *
   * `scores:manage` — the office — passes regardless, so a mark can still be
   * corrected for a teacher who has left mid-term.
   */
  private async canEdit(
    actor: AuthenticatedUser,
    subjectId: Types.ObjectId,
    classroomId: Types.ObjectId,
    semesterId: Types.ObjectId,
  ): Promise<boolean> {
    const managesAll = actor.permissions.some(
      (permission) => permission.resource === 'scores' && permission.actions.includes('manage'),
    );
    if (managesAll) return true;
    if (actor.personType !== 'teacher' || !actor.personId) return false;

    return this.assignments.isAssignedTeacher(actor.personId, subjectId, classroomId, semesterId);
  }

  private async assertCanEdit(
    actor: AuthenticatedUser,
    subjectId: Types.ObjectId,
    classroomId: Types.ObjectId,
    semesterId: Types.ObjectId,
  ): Promise<void> {
    if (!(await this.canEdit(actor, subjectId, classroomId, semesterId))) {
      throw AppException.forbidden('score.notAssignedTeacher', {
        subjectId: subjectId.toString(),
        classroomId: classroomId.toString(),
      });
    }
  }

  private subjectView(subject: SubjectDocument, strands: (string | null)[]) {
    return {
      id: subject._id.toString(),
      code: subject.code,
      nameLo: subject.nameLo,
      nameEn: subject.nameEn ?? null,
      strands: strands.filter((strand): strand is string => strand !== null),
    };
  }

  private classroomView(classroom: unknown) {
    const room = classroom as {
      _id: Types.ObjectId;
      name: string;
      gradeLevelId?: { code?: string | null } | null;
      homeroomTeacherId?: { firstNameLo?: string; lastNameLo?: string } | null;
    };
    return {
      id: room._id.toString(),
      name: room.name,
      gradeLevelCode: room.gradeLevelId?.code ?? null,
      // The sheet heads every page with the homeroom teacher, who is not
      // necessarily the one marking it.
      homeroomTeacherName: room.homeroomTeacherId
        ? `${room.homeroomTeacherId.firstNameLo ?? ''} ${room.homeroomTeacherId.lastNameLo ?? ''}`.trim()
        : null,
    };
  }

  private semesterView(semester: {
    _id: Types.ObjectId;
    number: number;
    nameLo: string;
    nameEn?: string | null;
  }) {
    return {
      id: semester._id.toString(),
      number: semester.number,
      nameLo: semester.nameLo,
      nameEn: semester.nameEn ?? null,
    };
  }
}

function cellKey(studentId: Types.ObjectId, strand: string | null | undefined): string {
  return `${studentId.toString()}|${strand ?? ''}`;
}

/** The sent value where one was sent, otherwise what the row already held. */
function pick(
  patch: Partial<Record<MonthlyColumn, number | null>>,
  existing: MonthlyMarkDocument | null,
  column: MonthlyColumn,
): number | null {
  if (column in patch) return patch[column] ?? null;
  return existing?.[column] ?? null;
}

function reasonOf(error: unknown): string {
  if (error instanceof AppException) return error.messageKey;
  return error instanceof Error ? error.message : 'unknown error';
}

/** What the class as a whole looks like — the line under the sheet. */
function summarize(rows: SheetRow[]) {
  const marked = rows.filter((row) => row.semesterMark !== null);
  const passed = marked.filter((row) => row.isPassing === true).length;

  return {
    students: rows.length,
    marked: marked.length,
    passed,
    failed: marked.length - passed,
    /** Rows still waiting on a month or the exam. */
    incomplete: rows.length - marked.length,
    average:
      marked.length === 0
        ? null
        : Math.round(
            (marked.reduce((sum, row) => sum + (row.semesterMark ?? 0), 0) / marked.length) * 100,
          ) / 100,
  };
}
