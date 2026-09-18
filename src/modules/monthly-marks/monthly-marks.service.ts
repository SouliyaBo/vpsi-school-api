import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isStudying, ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import { nicknameOf, populatedStudent } from 'src/common/utils/student-name';
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
import { SubjectsService } from '../subjects/subjects.service';
import { TeachingAssignmentsService } from '../teaching-assignments/teaching-assignments.service';
import { assignRanks, gradeFor, round2 } from '../term-results/grading';
import { GradingScaleService } from '../term-results/grading-scale.service';
import { TermResultStalenessService } from '../term-results/term-result-staleness.service';
import {
  AnnualSheetQueryDto,
  ClassMonthQueryDto,
  LockMonthDto,
  MonthGridQueryDto,
  SaveMarksResultDto,
  SaveMonthGridDto,
  SaveTermMarksDto,
  SheetQueryDto,
  StudentMonthsQueryDto,
} from './dto/monthly-mark.dto';
import {
  acrossSubjects,
  annualScore,
  classifyMonth,
  COLUMN_MAX,
  MARK_MAX,
  EMPTY_CELLS,
  isPassing,
  MONTHLY_COLUMNS,
  monthlyBandsFrom,
  monthScore,
  monthsForSemester,
  monthTotal,
  semesterScore,
  threeMonthAverage,
  type MonthCells,
  type MonthlyBandCuts,
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
    private readonly subjects: SubjectsService,
    private readonly gradingScale: GradingScaleService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogsService,
    private readonly staleness: TermResultStalenessService,
    private readonly scope: RecordScopeService,
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

    const roster = await this.loadRoster(classroom._id, [subject._id], semester._id);
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
      canEdit: await this.canEdit(actor, subject, classroom._id, semester._id),
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
    await this.assertCanEdit(actor, subject, classroom._id, semester._id);

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
      this.loadRoster(classroom._id, [subject._id], semester._id),
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
      canEdit: await this.canEdit(actor, subject, classroom._id, semester._id),
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
    await this.assertCanEdit(actor, subject, classroom._id, semester._id);

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
    await this.assertCanEdit(actor, subject, classroom._id, semester._id);

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

  /**
   * ສະຫຼຸບປະຈຳເດືອນ — one class, one month, every subject side by side.
   *
   * The per-subject sheets can each answer "how did this class do in ຄະນິດສາດ in
   * ຕຸລາ"; none of them can answer "how did this student do in ຕຸລາ", which is
   * the question the school asks at the end of every month and the one it ranks
   * on. The columns are the subjects the *grade* is marked in — four at ມ.1–ມ.3,
   * eight at ມ.4 and ມ.7, seven at ມ.5 and ມ.6 — read from the register rather
   * than from whichever subjects happen to have marks, so a subject nobody has
   * filled in yet shows as an empty column instead of vanishing.
   *
   * Derived on read, like every other figure here: there is no stored monthly
   * result to go stale behind a corrected cell.
   */
  async getClassMonth(query: ClassMonthQueryDto) {
    const [classroom, semester] = await Promise.all([
      this.classrooms.findOnePopulated(query.classroomId),
      query.semesterId
        ? this.semesters.findOne(query.semesterId)
        : this.semesters.getActiveOrFail(),
    ]);

    const gradeLevelId = gradeLevelIdOf(classroom);
    const subjects = gradeLevelId ? await this.subjects.findMarkedForGradeLevel(gradeLevelId) : [];

    const months = await this.monthsFor(semester.number);
    const subjectIds = subjects.map((subject) => subject._id);
    const [scale, bands] = await Promise.all([this.gradingScale.resolve(), this.monthlyBands()]);

    const [roster, marks] = await Promise.all([
      this.loadRoster(classroom._id, subjectIds, semester._id),
      subjectIds.length === 0
        ? Promise.resolve([])
        : this.model
            .find({
              classroomId: classroom._id,
              semesterId: semester._id,
              subjectId: { $in: subjectIds },
              month: query.month,
              deletedAt: null,
            })
            .lean()
            .exec(),
    ]);

    /** studentId → subjectId → strand → the four cells. */
    const cells = new Map<string, Map<string, Map<string, MonthCells>>>();
    for (const mark of marks) {
      const byStudent = cells.get(mark.studentId.toString()) ?? new Map();
      const bySubject = byStudent.get(mark.subjectId.toString()) ?? new Map();
      bySubject.set(mark.strand ?? '', {
        attendance: mark.attendance ?? null,
        notebook: mark.notebook ?? null,
        activity: mark.activity ?? null,
        test: mark.test ?? null,
      });
      byStudent.set(mark.subjectId.toString(), bySubject);
      cells.set(mark.studentId.toString(), byStudent);
    }

    /**
     * A mark out of 10 banded on a scale held as percentages.
     *
     * Every mark in the system is a 0–100 figure and the sheet shows it out of
     * 10, so the monthly average is scaled back up before it is banded rather
     * than the scale being kept twice in two units.
     */
    const gradeOf = (value: number) => gradeFor((value / MARK_MAX) * 100, scale).grade;

    const rows = roster.map((student) => {
      const byStudent = cells.get(student.studentId);

      const scores = subjects.map((subject) => {
        const written = byStudent?.get(subject._id.toString());
        if (!written) return null;
        const strands = this.strandsOf(subject);
        const totals = strands.map((strand) =>
          monthTotal(written.get(strand ?? '') ?? EMPTY_CELLS),
        );
        return monthScore(totals, strands.length).value;
      });

      /**
       * ກວດກາ on its own, out of 6 — the one column of the four the parent
       * report prints beside ລວມ.
       *
       * The school's letter home shows the test mark as its own line above the
       * month's total, so a parent can see whether a 6.5 is a child who sat the
       * test badly or one who missed the notebook and activity marks. Averaged
       * across strands the way ລວມ is, for the subjects that have them.
       */
      const testScores = subjects.map((subject) => {
        const written = byStudent?.get(subject._id.toString());
        if (!written) return null;
        const tests = this.strandsOf(subject)
          .map((strand) => written.get(strand ?? '')?.test ?? null)
          .filter((test): test is number => test !== null);
        if (tests.length === 0) return null;
        return round2(tests.reduce((sum, test) => sum + test, 0) / tests.length);
      });

      const recorded = scores.filter((score): score is number => score !== null);
      const average = acrossSubjects(scores, subjects.length);

      return {
        ...student,
        scores,
        testScores,
        /**
         * ເກຣດ per subject — the letter for each month's ລວມ, banded on the same
         * scale as the average's, so the parent report cannot band a subject on
         * one rule and the month on another.
         */
        subjectGrades: scores.map((score) => (score === null ? null : gradeOf(score))),
        /** ລວມ — the marks as written, before they are divided. */
        total: recorded.length > 0 ? round2(recorded.reduce((sum, score) => sum + score, 0)) : null,
        average: average.value,
        isComplete: average.isComplete,
        subjectsRecorded: recorded.length,
        /**
         * ເກຣດ — the school's band for the month's average.
         *
         * Withheld until the month is finished, like ຜ່ານ/ຕົກ: an average
         * divided by eight subjects of which three are unmarked would band as an
         * F for a reason that is not the student's marks.
         */
        grade: average.isComplete && average.value !== null ? gradeOf(average.value) : null,
        /**
         * ຈັດປະເພດ — ເກັ່ງ / ກາງ / ອ່ອນ, withheld on the same terms as ເກຣດ.
         *
         * Banded here rather than by whoever prints the sheet: the cuts are the
         * office's, they are kept in settings beside the grade scale, and a
         * report that worked them out for itself would be a second place for
         * them to be wrong.
         */
        classification:
          average.isComplete && average.value !== null ? classifyMonth(average.value, bands) : null,
        isPassing: isPassing(average.value),
        // Filled in below: a rank cannot be decided one student at a time.
        rank: null as number | null,
      };
    });

    /**
     * ລຳດັບ over the students who have a mark this month.
     *
     * Competition ranking, matching the term result: equal averages share a rank
     * and the next one skips. A student with nothing recorded is unranked rather
     * than last — they have not been beaten, they have not been marked.
     */
    const ranks = assignRanks(
      rows
        .filter((row) => row.average !== null)
        .map((row) => ({ studentId: row.studentId, average: row.average as number })),
    );
    for (const row of rows) row.rank = ranks.get(row.studentId) ?? null;

    rows.sort((a, b) => (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999));

    const marked = rows.filter((row) => row.average !== null);
    // ຜ່ານ/ຕົກ is only counted where the month is finished, matching the verdict
    // each row carries: an average divided by eight subjects of which three are
    // unmarked is below the pass line for a reason that is not the student's.
    const decided = marked.filter((row) => row.isComplete);
    return {
      classroom: this.classroomView(classroom),
      semester: this.semesterView(semester),
      month: query.month,
      months,
      // The sheet carries the cuts it was banded on, so a printed copy can say
      // what ເກັ່ງ meant on the day it was printed.
      bands,
      subjects: subjects.map((subject) => ({
        id: subject._id.toString(),
        code: subject.code,
        nameLo: subject.nameLo,
        nameEn: subject.nameEn ?? null,
      })),
      rows,
      summary: {
        students: rows.length,
        marked: marked.length,
        passed: decided.filter((row) => row.isPassing).length,
        failed: decided.filter((row) => row.isPassing === false).length,
        // Waiting on at least one subject, so the month is not finished.
        incomplete: marked.filter((row) => !row.isComplete).length,
        average:
          marked.length > 0
            ? round2(marked.reduce((sum, row) => sum + (row.average as number), 0) / marked.length)
            : null,
      },
    };
  }

  /**
   * ຄະແນນປະຈຳເດືອນ for one student, month by month.
   *
   * The class summary answers "how did ມ.4/ກ do in ຕຸລາ"; a parent standing at
   * the office counter asks the other question — "how has *this* child done, ກັນຍາ
   * through ພະຈິກ" — and no sheet here could answer it without reading three
   * class summaries and picking one row out of each.
   *
   * Two views of the same numbers, because the school reads them both ways: the
   * months across, as the summary ranks them, and the subjects down, ending in
   * ພາກຮຽນ as the term sheet does. ລຳດັບ still has to be worked out over the whole
   * class — a rank is not a fact about one student — so the class's marks are
   * read even though only one row is returned.
   *
   * The room comes from the register rather than from the caller: the student is
   * looked up in whichever class they sat that term, so a page that knows only a
   * child's id can ask.
   */
  async getStudentMonths(query: StudentMonthsQueryDto, actor: AuthenticatedUser) {
    // Checked before anything is read, so the answer cannot differ depending on
    // whether the child has marks — the same order as the term result.
    await this.scope.assertCanAccessStudent(actor, query.studentId);

    const semester = query.semesterId
      ? await this.semesters.findOne(query.semesterId)
      : await this.semesters.getActiveOrFail();
    const months = await this.monthsFor(semester.number);
    const studentId = new Types.ObjectId(query.studentId);

    /**
     * The placement the marks were earned under.
     *
     * A transfer leaves two rows for the same year — the origin `transferred`,
     * the destination `active` — so the active one wins and the latest stands in
     * for a child who has since left, whose marks are still theirs.
     */
    const enrollments = await this.enrollmentModel
      .find({ studentId, schoolYearId: semester.schoolYearId, deletedAt: null })
      .sort({ enrolledAt: -1 })
      .lean()
      .exec();
    const placement = enrollments.find((row) => row.status === 'active') ?? enrollments[0] ?? null;

    // Not an error: a child admitted but not yet placed is an ordinary state of
    // the register, and the page says so rather than showing a failure.
    if (!placement) {
      return {
        classroom: null,
        semester: this.semesterView(semester),
        rollNumber: null,
        isEnrolled: false,
        months,
        subjects: [],
        monthly: [],
        subjectRows: [],
        summary: {
          subjects: 0,
          monthsRecorded: 0,
          termTotal: null,
          termSubjectsRecorded: 0,
          termAverage: null,
          termComplete: false,
          termGrade: null,
        },
      };
    }

    const classroom = await this.classrooms.findOnePopulated(placement.classroomId.toString());
    const gradeLevelId = gradeLevelIdOf(classroom);
    const subjects = gradeLevelId ? await this.subjects.findMarkedForGradeLevel(gradeLevelId) : [];
    const subjectIds = subjects.map((subject) => subject._id);
    const scale = await this.gradingScale.resolve();

    const [roster, marks, termMarks] = await Promise.all([
      this.loadRoster(classroom._id, subjectIds, semester._id),
      subjectIds.length === 0
        ? Promise.resolve([])
        : this.model
            .find({
              classroomId: classroom._id,
              semesterId: semester._id,
              subjectId: { $in: subjectIds },
              month: { $in: months },
              deletedAt: null,
            })
            .lean()
            .exec(),
      subjectIds.length === 0
        ? Promise.resolve([])
        : this.termModel
            .find({
              studentId,
              classroomId: classroom._id,
              semesterId: semester._id,
              subjectId: { $in: subjectIds },
              deletedAt: null,
            })
            .lean()
            .exec(),
    ]);

    /** studentId → month → subjectId → strand → the four cells. */
    const cells = new Map<string, Map<number, Map<string, Map<string, MonthCells>>>>();
    for (const mark of marks) {
      const student = mark.studentId.toString();
      const byStudent =
        cells.get(student) ?? new Map<number, Map<string, Map<string, MonthCells>>>();
      const byMonth = byStudent.get(mark.month) ?? new Map<string, Map<string, MonthCells>>();
      const bySubject = byMonth.get(mark.subjectId.toString()) ?? new Map<string, MonthCells>();

      bySubject.set(mark.strand ?? '', {
        attendance: mark.attendance ?? null,
        notebook: mark.notebook ?? null,
        activity: mark.activity ?? null,
        test: mark.test ?? null,
      });
      byMonth.set(mark.subjectId.toString(), bySubject);
      byStudent.set(mark.month, byMonth);
      cells.set(student, byStudent);
    }

    const strandsBySubject = new Map(
      subjects.map((subject) => [subject._id.toString(), this.strandsOf(subject)]),
    );

    /** One month of one student, as one mark per subject column. */
    const scoresOf = (student: string, month: number): (number | null)[] => {
      const byMonth = cells.get(student)?.get(month);
      return subjects.map((subject) => {
        const written = byMonth?.get(subject._id.toString());
        if (!written) return null;
        const strands = strandsBySubject.get(subject._id.toString()) ?? [null];
        const totals = strands.map((strand) =>
          monthTotal(written.get(strand ?? '') ?? EMPTY_CELLS),
        );
        return monthScore(totals, strands.length).value;
      });
    };

    /**
     * ກວດກາ on its own, out of 6, per subject — the parent report's own line,
     * derived exactly as the class summary derives it so the child's page and
     * the letter home cannot show two different test marks.
     */
    const testScoresOf = (student: string, month: number): (number | null)[] => {
      const byMonth = cells.get(student)?.get(month);
      return subjects.map((subject) => {
        const written = byMonth?.get(subject._id.toString());
        if (!written) return null;
        const tests = (strandsBySubject.get(subject._id.toString()) ?? [null])
          .map((strand) => written.get(strand ?? '')?.test ?? null)
          .filter((test): test is number => test !== null);
        if (tests.length === 0) return null;
        return round2(tests.reduce((sum, test) => sum + test, 0) / tests.length);
      });
    };

    const gradeOf = (value: number) => gradeFor((value / MARK_MAX) * 100, scale).grade;

    const monthly = months.map((month) => {
      // ລຳດັບ is decided over the class, so every roster row's average for this
      // month is worked out even though one row is returned. Same competition
      // ranking as the class summary: equal averages share a rank.
      const ranked = roster
        .map((student) => ({
          studentId: student.studentId,
          average: acrossSubjects(scoresOf(student.studentId, month), subjects.length).value,
        }))
        .filter((entry): entry is { studentId: string; average: number } => entry.average !== null);
      const ranks = assignRanks(ranked);

      const scores = scoresOf(query.studentId, month);
      const recorded = scores.filter((score): score is number => score !== null);
      const average = acrossSubjects(scores, subjects.length);

      return {
        month,
        scores,
        testScores: testScoresOf(query.studentId, month),
        /** The letter for each subject's ລວມ, on the same scale as the average's. */
        subjectGrades: scores.map((score) => (score === null ? null : gradeOf(score))),
        /** ລວມ — the marks as written, before they are divided. */
        total: recorded.length > 0 ? round2(recorded.reduce((sum, score) => sum + score, 0)) : null,
        average: average.value,
        isComplete: average.isComplete,
        subjectsRecorded: recorded.length,
        // Withheld until the month is finished, as on the class sheet: an
        // average divided by eight subjects of which three are unmarked would
        // band low for a reason that is not the student's marks.
        grade: average.isComplete && average.value !== null ? gradeOf(average.value) : null,
        rank: ranks.get(query.studentId) ?? null,
        /** How many of the class were ranked — the denominator ລຳດັບ is out of. */
        rankedStudents: ranked.length,
        isPassing: isPassing(average.value),
      };
    });

    const termBySubject = new Map(termMarks.map((mark) => [mark.subjectId.toString(), mark]));

    // The same numbers turned the other way: one row a subject, the months
    // across it, ending in ພາກຮຽນ exactly as the term sheet computes it.
    const subjectRows = subjects.map((subject, index) => {
      const monthScores = monthly.map((entry) => entry.scores[index]);
      const threeMonth = threeMonthAverage(monthScores, months.length);
      const term = termBySubject.get(subject._id.toString());
      const mark = semesterScore(threeMonth.value, term?.examScore ?? null, term?.bonus ?? null);

      return {
        subject: {
          id: subject._id.toString(),
          code: subject.code,
          nameLo: subject.nameLo,
          nameEn: subject.nameEn ?? null,
        },
        monthScores,
        threeMonth: threeMonth.value,
        threeMonthComplete: threeMonth.isComplete,
        examScore: term?.examScore ?? null,
        bonus: term?.bonus ?? null,
        semesterMark: mark.value,
        /** The letter for ພາກຮຽນ, banded as a month's ລວມ is. */
        semesterGrade: mark.value === null ? null : gradeOf(mark.value),
        isPassing: isPassing(mark.value),
      };
    });

    // ສະເລ່ຍ over the term marks, divided by the subjects the grade sits — the
    // same divisor the monthly average uses, so a term short of a subject reads
    // as unfinished rather than as finished and low.
    const termMarksRecorded = subjectRows
      .map((row) => row.semesterMark)
      .filter((mark): mark is number => mark !== null);
    const termAverage = acrossSubjects(
      subjectRows.map((row) => row.semesterMark),
      subjects.length,
    );

    const rosterRow = roster.find((student) => student.studentId === query.studentId);
    return {
      classroom: this.classroomView(classroom),
      semester: this.semesterView(semester),
      rollNumber: placement.rollNumber ?? null,
      isEnrolled: placement.status === 'active',
      months,
      subjects: subjects.map((subject) => ({
        id: subject._id.toString(),
        code: subject.code,
        nameLo: subject.nameLo,
        nameEn: subject.nameEn ?? null,
      })),
      monthly,
      subjectRows,
      summary: {
        subjects: subjects.length,
        monthsRecorded: monthly.filter((entry) => entry.average !== null).length,
        /** ລວມ of the term marks as written — the parent block's standing figure. */
        termTotal:
          termMarksRecorded.length > 0
            ? round2(termMarksRecorded.reduce((sum, mark) => sum + mark, 0))
            : null,
        termSubjectsRecorded: termMarksRecorded.length,
        termAverage: termAverage.value,
        termComplete: termAverage.isComplete,
        // ເກຣດ for the term, withheld while a subject is still short of its
        // ພາກຮຽນ — for the reason a month's is.
        termGrade:
          termAverage.isComplete && termAverage.value !== null
            ? gradeOf(termAverage.value)
            : null,
        // A student off the sheet — left the school, or moved out of this room —
        // is still shown their marks, with the page free to say so.
        onRoster: rosterRow !== undefined,
      },
    };
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

    /**
     * A ສາຍວິຊາ the mark sheet splits carries no marks of its own.
     *
     * ທຳມະຊາດ at ມ.4 is taught, assigned and registered against, but it is
     * ຟີຊິກສາດ, ເຄມີສາດ and ຊີວະສາດ that are marked and examined. A sheet drawn
     * against the parent would be a second, competing set of marks for the same
     * three subjects, so it is refused outright rather than left to fill in.
     */
    if (await this.subjects.isSplitParent(subject._id)) {
      throw AppException.badRequest('score.subjectIsSplit', {
        subjectId: subject._id.toString(),
        reason: 'this subject is marked as its split subjects, not as a whole',
      });
    }

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

  /** ຈັດປະເພດ cuts from settings, falling back to the school's own 7 and 5. */
  private async monthlyBands(): Promise<MonthlyBandCuts> {
    return monthlyBandsFrom(
      await this.settings.getValue<Partial<MonthlyBandCuts>>('grading.monthlyBands'),
    );
  }

  private async monthsFor(semesterNumber: number): Promise<number[]> {
    const configured =
      await this.settings.getValue<Record<string, number[]>>('grading.semesterMonths');
    return monthsForSemester(semesterNumber, configured);
  }

  /**
   * The class list the sheet is drawn against.
   *
   * ກຳລັງຮຽນ only. A student who has graduated, declined the certificate, moved
   * away, dropped out or been suspended has no exam to sit and no mark to earn,
   * so they come off the sheet: any marks already written stay in the database
   * untouched, but nobody can go on adding to them. Stricter than roll call by
   * `no_certificate`, which is why this reads `isStudying` and not the wider
   * `isOnCurrentRoll`.
   *
   * Within that roll it is the active enrolments, plus anyone moved out of this
   * class who already has marks on this subject — the school keeps that row and
   * records zeros against it, and a sheet that dropped them would lose marks
   * already earned.
   */
  private async loadRoster(
    classroomId: Types.ObjectId,
    subjectIds: Types.ObjectId[],
    semesterId: Types.ObjectId,
  ) {
    const [enrollments, markedIds] = await Promise.all([
      this.enrollmentModel
        .find({ classroomId, deletedAt: null })
        .populate('studentId', ROSTER_STUDENT_SELECT)
        .sort({ rollNumber: 1 })
        .lean()
        .exec(),
      this.model.distinct('studentId', {
        subjectId: { $in: subjectIds },
        classroomId,
        semesterId,
        deletedAt: null,
      }),
    ]);

    const marked = new Set(markedIds.map((id) => id.toString()));

    return enrollments
      .filter((enrollment) => isStudying(enrollment.studentId))
      .map((enrollment) => {
        const student = populatedStudent(enrollment.studentId);
        return {
          // Read off the populated ref rather than `studentId.toString()`, which
          // on a populated lean row is the string `[object Object]`.
          studentId: student?._id.toString() ?? String(enrollment.studentId),
          studentCode: enrollment.studentCode,
          studentNameLo: enrollment.studentNameLo,
          studentNickname: nicknameOf(student),
          rollNumber: enrollment.rollNumber ?? null,
          isEnrolled: enrollment.status === 'active',
        };
      })
      .filter((row) => row.isEnrolled || marked.has(row.studentId));
  }

  /**
   * Who a save is allowed to name — the same roll the sheet is drawn from, so a
   * stale grid still open on a teacher's screen cannot write a mark for a child
   * who has since left the school.
   */
  private async enrolledIds(classroomId: Types.ObjectId): Promise<Set<string>> {
    const roster = await this.enrollmentModel
      .find({ classroomId, status: 'active', deletedAt: null })
      .select('studentId')
      .populate('studentId', 'status')
      .lean()
      .exec();
    return new Set(
      roster
        .filter((row) => isStudying(row.studentId))
        .map((row) => populatedStudent(row.studentId)?._id.toString() ?? String(row.studentId)),
    );
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
    subject: SubjectDocument,
    classroomId: Types.ObjectId,
    semesterId: Types.ObjectId,
  ): Promise<boolean> {
    const managesAll = actor.permissions.some(
      (permission) => permission.resource === 'scores' && permission.actions.includes('manage'),
    );
    if (managesAll) return true;
    if (actor.personType !== 'teacher' || !actor.personId) return false;

    /**
     * Permission follows the timetable, and the timetable runs on ສາຍວິຊາ.
     *
     * Nobody is assigned to teach ຟີຊິກສາດ — they are assigned to ທຳມະຊາດ, which
     * from ມ.4 is marked as three subjects. Checking the split subject itself
     * would find no assignment and lock out the very teacher who sits the exam.
     */
    return this.assignments.isAssignedTeacher(
      actor.personId,
      this.subjects.markingParentOf(subject),
      classroomId,
      semesterId,
    );
  }

  private async assertCanEdit(
    actor: AuthenticatedUser,
    subject: SubjectDocument,
    classroomId: Types.ObjectId,
    semesterId: Types.ObjectId,
  ): Promise<void> {
    if (!(await this.canEdit(actor, subject, classroomId, semesterId))) {
      throw AppException.forbidden('score.notAssignedTeacher', {
        subjectId: subject._id.toString(),
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

/**
 * The grade a class sits, off a populated classroom.
 *
 * `findOnePopulated` resolves `gradeLevelId` to the document, so the id has to
 * be read back off it — the raw field is an object here, not an id.
 */
function gradeLevelIdOf(classroom: unknown): Types.ObjectId | null {
  const room = classroom as { gradeLevelId?: { _id?: Types.ObjectId } | Types.ObjectId | null };
  const level = room.gradeLevelId;
  if (!level) return null;
  return (level as { _id?: Types.ObjectId })._id ?? (level as Types.ObjectId);
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
