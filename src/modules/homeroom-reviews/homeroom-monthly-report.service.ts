import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import {
  buildMonthlyReport,
  type AttendanceNote,
  type ConductStanding,
  type MonthlyReportBody,
  type ReportStudent,
} from 'src/common/homeroom-review/monthly-report';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isOnCurrentRoll, ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import { LAO_MONTHS } from 'src/common/utils/lao-date';
import { populatedStudent, registerName } from 'src/common/utils/student-name';
import {
  Attendance,
  AttendanceDocument,
  BehaviorLog,
  BehaviorLogDocument,
  Classroom,
  ClassroomDocument,
  ConductDeduction,
  ConductDeductionDocument,
  Enrollment,
  EnrollmentDocument,
  HomeroomMonthlyReport,
  HomeroomMonthlyReportDocument,
  HomeroomReview,
  HomeroomReviewDocument,
  SemesterDocument,
  Subject,
  SubjectDocument,
  Teacher,
  TeacherDocument,
} from 'src/database/schemas';
import {
  daysLate,
  reportDueDate,
  reportOpensAt,
  reportStatus,
  type MonthlyReportStatus,
} from 'src/common/homeroom-review/monthly-report-deadline';
import { AttendancesService } from '../attendances/attendances.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { escalationFor } from '../conduct-deductions/conduct-escalation';
import { MonthlyMarksService } from '../monthly-marks/monthly-marks.service';
import { SemestersService } from '../semesters/semesters.service';
import {
  MonthlyReportComplianceQueryDto,
  MonthlyReportQueryDto,
  SaveMonthlyReportDto,
} from './dto/homeroom-review.dto';

/** How a contact to every guardian in the room is named on the report. */
export const ALL_STUDENTS_LO = 'ນັກຮຽນທັງໝົດ';

export interface MonthlyReport extends MonthlyReportBody {
  classroom: {
    id: string;
    name: string;
    /** For the extra-class subject picker; absent on reports sent before it. */
    gradeLevelId?: string | null;
    gradeLevelCode: string | null;
    teacherName: string | null;
  };
  semester: { id: string; number: number; nameLo: string | null };
  month: number;
  year: number;
  monthNameLo: string;
  /** The first and last day of the month counted, ISO dates. */
  from: string;
  to: string;
}

/** The teacher's own four sections, as stored. */
export interface MonthlyReportEntry {
  overview: string | null;
  extraClasses: {
    studentId: string;
    studentNameLo: string | null;
    /** `null` on a row typed before the subject picker. */
    subjectId: string | null;
    subject: string;
    teacherId: string | null;
    teacherName: string | null;
  }[];
  outsideActivities: {
    studentId: string;
    studentNameLo: string | null;
    date: string | null;
    detail: string;
  }[];
  /** III. contacts the teacher recorded by hand — the reviews' own are in `guardianContacts`. */
  guardianContacts: {
    /** `null` for a contact to the whole class. */
    studentId: string | null;
    allStudents: boolean;
    studentNameLo: string | null;
    date: string;
    content: string;
  }[];
  suggestions: string | null;
}

export interface MonthlyReportSubmission {
  status: MonthlyReportStatus;
  /** Calendar date the report is due by — the 5th of the next month. */
  dueDate: string;
  /** When it can first be sent: the month's last day. */
  opensAt: string;
  canSubmit: boolean;
  firstSubmittedAt: string | null;
  lastSubmittedAt: string | null;
  daysLate: number;
  /** A draft has been saved. */
  hasDraft: boolean;
}

/** What the screen reads: the report, the teacher's sections, and where it stands. */
export interface MonthlyReportView extends MonthlyReport {
  entry: MonthlyReportEntry;
  submission: MonthlyReportSubmission;
  /** The figures are the copy taken when it was sent, not today's. */
  isSnapshot: boolean;
  /** The room's current roll — who the teacher's rows may name. */
  roster: { studentId: string; studentCode: string | null; studentNameLo: string }[];
}

export interface MonthlyReportComplianceCell {
  year: number;
  month: number;
  status: MonthlyReportStatus;
  dueDate: string;
  firstSubmittedAt: string | null;
  daysLate: number;
}

export interface MonthlyReportCompliance {
  semester: { id: string; nameLo: string | null };
  months: { year: number; month: number; monthNameLo: string; dueDate: string }[];
  rows: {
    classroomId: string;
    classroomName: string;
    gradeLevelCode: string | null;
    teacherName: string | null;
    cells: MonthlyReportComplianceCell[];
  }[];
  summary: Record<MonthlyReportStatus, number>;
}

interface ReportContext {
  room: Record<string, unknown> & { _id: Types.ObjectId; name: string };
  homeroomTeacher: { _id: Types.ObjectId; firstNameLo?: string; lastNameLo?: string } | null;
  semester: SemesterDocument;
  range: { from: Date; to: Date };
  month: number;
  year: number;
  roster: ReportStudent[];
}

/**
 * ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ — reads the month's facts and hands them to
 * `buildMonthlyReport`.
 *
 * The figures come from the same places their own screens read: the attendance
 * summary through `AttendancesService` so the three-lates rule is applied once,
 * the ກວດກາ marks through the class month sheet, the conduct ladder through
 * `escalationFor`. Only the rows behind the counts — the reasons written on the
 * roll, the register's lines, the ledger's rules — are read directly, because
 * no service hands back the text.
 */
@Injectable()
export class HomeroomMonthlyReportService {
  constructor(
    @InjectModel(HomeroomReview.name) private readonly reviews: Model<HomeroomReviewDocument>,
    @InjectModel(Classroom.name) private readonly classrooms: Model<ClassroomDocument>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<EnrollmentDocument>,
    @InjectModel(Attendance.name) private readonly attendanceModel: Model<AttendanceDocument>,
    @InjectModel(BehaviorLog.name) private readonly behaviorModel: Model<BehaviorLogDocument>,
    @InjectModel(ConductDeduction.name)
    private readonly deductionModel: Model<ConductDeductionDocument>,
    private readonly semesters: SemestersService,
    private readonly attendances: AttendancesService,
    private readonly monthlyMarks: MonthlyMarksService,
    private readonly scope: RecordScopeService,
    @InjectModel(HomeroomMonthlyReport.name)
    private readonly stored: Model<HomeroomMonthlyReportDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * The report as the screen and the Word file show it.
   *
   * Once sent, the figures are the copy taken at sending — what the teacher put
   * their name to; before that, they are read live.
   */
  async build(
    query: MonthlyReportQueryDto,
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<MonthlyReportView> {
    const ctx = await this.context(query, actor);
    const saved = await this.findStored(ctx);
    const generated = saved?.lastSubmittedAt && saved.generated ? saved.generated : null;
    const report = generated
      ? ({
          ...(generated as unknown as MonthlyReport),
          semester: this.semesterView(ctx),
        } as MonthlyReport)
      : await this.generate(ctx);
    const grade = ctx.room.gradeLevelId as unknown as { _id?: Types.ObjectId } | null;
    return {
      ...report,
      // Read live: a snapshot from before the picker does not carry it.
      classroom: { ...report.classroom, gradeLevelId: grade?._id ? String(grade._id) : null },
      entry: this.entryOf(saved),
      submission: this.submissionOf(ctx, saved, now),
      isSnapshot: Boolean(generated),
      roster: ctx.roster.map(({ studentId, studentCode, studentNameLo }) => ({
        studentId,
        studentCode,
        studentNameLo,
      })),
    };
  }

  /**
   * Saves the teacher's sections; with `submit`, also sends the report.
   *
   * A resend is allowed and refreshes the copy the office reads, but lateness
   * stays judged on the first send — see `monthly-report-deadline.ts`.
   */
  async save(
    dto: SaveMonthlyReportDto,
    actor: AuthenticatedUser,
    options: { submit: boolean; ip?: string | null; now?: Date },
  ): Promise<MonthlyReportView> {
    const now = options.now ?? new Date();
    const ctx = await this.context(dto, actor, { forWriting: true });
    if (options.submit && now < reportOpensAt(ctx.year, ctx.month)) {
      throw AppException.badRequest('homeroomReview.reportNotOpen', {
        opensAt: reportOpensAt(ctx.year, ctx.month).toISOString(),
      });
    }

    const onRoll = new Map(ctx.roster.map((student) => [student.studentId, student]));
    const nameOf = (studentId: string) => {
      const student = onRoll.get(studentId);
      if (!student) throw AppException.badRequest('homeroomReview.studentNotOnRoll');
      return student.studentNameLo;
    };

    const { subjectName, teacherName } = await this.extraClassNames(dto);

    const fields = {
      overview: dto.overview?.trim() || null,
      suggestions: dto.suggestions?.trim() || null,
      extraClasses: dto.extraClasses.map((row) => {
        // A picked subject or teacher is printed under the name on file today
        // and keeps that name; a typed one (rows written before the pickers) is
        // kept as typed.
        const subject = row.subjectId ? subjectName.get(row.subjectId) : row.subject?.trim();
        if (!subject) throw AppException.badRequest('homeroomReview.extraClassSubjectRequired');
        return {
          studentId: new Types.ObjectId(row.studentId),
          studentNameLo: nameOf(row.studentId),
          subjectId: row.subjectId ? new Types.ObjectId(row.subjectId) : null,
          subject,
          teacherId: row.teacherId ? new Types.ObjectId(row.teacherId) : null,
          teacherName: row.teacherId
            ? (teacherName.get(row.teacherId) ?? null)
            : row.teacherName?.trim() || null,
        };
      }),
      outsideActivities: dto.outsideActivities
        .filter((row) => row.detail.trim())
        .map((row) => ({
          studentId: new Types.ObjectId(row.studentId),
          studentNameLo: nameOf(row.studentId),
          date: row.date ? new Date(`${row.date.slice(0, 10)}T00:00:00.000Z`) : null,
          detail: row.detail.trim(),
        })),
      guardianContacts: (dto.guardianContacts ?? [])
        .filter((row) => row.content.trim())
        .map((row) => ({
          ...(row.allStudents
            ? { studentId: null, allStudents: true, studentNameLo: ALL_STUDENTS_LO }
            : {
                studentId: new Types.ObjectId(row.studentId),
                allStudents: false,
                studentNameLo: nameOf(row.studentId!),
              }),
          date: new Date(`${row.date.slice(0, 10)}T00:00:00.000Z`),
          content: row.content.trim(),
        })),
      recordedById: new Types.ObjectId(actor.sub),
    };

    const existing = await this.findStored(ctx);
    const submission = options.submit
      ? {
          firstSubmittedAt: existing?.firstSubmittedAt ?? now,
          lastSubmittedAt: now,
          submittedById: new Types.ObjectId(actor.sub),
          generated: (await this.generate(ctx)) as unknown as Record<string, unknown>,
        }
      : {};

    const saved = existing
      ? await this.stored
          .findByIdAndUpdate(existing._id, { $set: { ...fields, ...submission } }, { new: true })
          .exec()
      : await this.stored.create({
          classroomId: ctx.room._id,
          teacherId: ctx.homeroomTeacher!._id,
          schoolYearId: ctx.semester.schoolYearId,
          semesterId: ctx.semester._id,
          year: ctx.year,
          month: ctx.month,
          ...fields,
          ...submission,
        });

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: existing ? 'update' : 'create',
      entityType: 'HomeroomMonthlyReport',
      entityId: saved!._id.toString(),
      newValue: {
        classroomId: ctx.room._id.toString(),
        year: ctx.year,
        month: ctx.month,
        submitted: options.submit,
        status: reportStatus(ctx.year, ctx.month, saved!.firstSubmittedAt, now),
      },
      ip: options.ip ?? null,
    });

    return this.build(dto, actor, now);
  }

  /**
   * The office's grid: every room of the term against every month it has
   * reached, and where each report stands.
   */
  async compliance(
    query: MonthlyReportComplianceQueryDto,
    now: Date = new Date(),
  ): Promise<MonthlyReportCompliance> {
    const semester = query.semesterId
      ? await this.semesters.findOne(query.semesterId)
      : await this.semesters.getActiveOrFail();

    // Every month the term touches whose report can already be sent — a month
    // still running is not yet owed, and would only fill the grid with grey.
    const months: MonthlyReportCompliance['months'] = [];
    const cursor = new Date(semester.startDate);
    cursor.setUTCDate(1);
    while (cursor <= new Date(semester.endDate) && months.length < 12) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      if (reportOpensAt(year, month) <= now) {
        months.push({
          year,
          month,
          monthNameLo: LAO_MONTHS[month] ?? String(month),
          dueDate: reportDueDate(year, month),
        });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const rooms = await this.classrooms
      .find({ schoolYearId: semester.schoolYearId, isActive: true, deletedAt: null })
      .populate([
        { path: 'gradeLevelId', select: 'code' },
        { path: 'homeroomTeacherId', select: 'firstNameLo lastNameLo' },
      ])
      .sort({ name: 1 })
      .lean()
      .exec();

    const reports = await this.stored
      .find({
        classroomId: { $in: rooms.map((room) => room._id) },
        semesterId: semester._id,
        deletedAt: null,
      })
      .select('classroomId year month firstSubmittedAt')
      .lean()
      .exec();
    const byKey = new Map(
      reports.map((report) => [
        `${String(report.classroomId)}:${report.year}:${report.month}`,
        report,
      ]),
    );

    const summary: Record<MonthlyReportStatus, number> = {
      submitted: 0,
      late: 0,
      missing: 0,
      pending: 0,
    };
    const rows = rooms.map((room) => {
      const grade = room.gradeLevelId as unknown as { code?: string } | null;
      const teacher = room.homeroomTeacherId as unknown as {
        firstNameLo?: string;
        lastNameLo?: string;
      } | null;
      const cells = months.map(({ year, month }) => {
        const sentAt = byKey.get(`${String(room._id)}:${year}:${month}`)?.firstSubmittedAt ?? null;
        const status = reportStatus(year, month, sentAt, now);
        summary[status] += 1;
        return {
          year,
          month,
          status,
          dueDate: reportDueDate(year, month),
          firstSubmittedAt: sentAt ? sentAt.toISOString() : null,
          daysLate: status === 'pending' ? 0 : daysLate(year, month, sentAt, now),
        };
      });
      return {
        classroomId: String(room._id),
        classroomName: room.name,
        gradeLevelCode: grade?.code ?? null,
        teacherName: teacher
          ? `${teacher.firstNameLo ?? ''} ${teacher.lastNameLo ?? ''}`.trim() || null
          : null,
        cells,
      };
    });

    return {
      semester: { id: semester._id.toString(), nameLo: semester.nameLo ?? null },
      months,
      rows,
      summary,
    };
  }

  private async findStored(ctx: ReportContext) {
    return this.stored
      .findOne({ classroomId: ctx.room._id, year: ctx.year, month: ctx.month, deletedAt: null })
      .exec();
  }

  /**
   * The names behind the picked subjects and teachers, as they stand today.
   * An id that matches nothing on file is refused rather than printed blank.
   */
  private async extraClassNames(dto: SaveMonthlyReportDto) {
    const subjectIds = [
      ...new Set(dto.extraClasses.flatMap((row) => (row.subjectId ? [row.subjectId] : []))),
    ];
    const teacherIds = [
      ...new Set(dto.extraClasses.flatMap((row) => (row.teacherId ? [row.teacherId] : []))),
    ];
    const [subjects, teachers] = await Promise.all([
      subjectIds.length
        ? this.subjectModel
            .find({ _id: { $in: subjectIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null })
            .select('nameLo')
            .lean()
            .exec()
        : [],
      teacherIds.length
        ? this.teacherModel
            .find({ _id: { $in: teacherIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null })
            .select('firstNameLo lastNameLo')
            .lean()
            .exec()
        : [],
    ]);
    if (subjects.length !== subjectIds.length || teachers.length !== teacherIds.length) {
      throw AppException.badRequest('homeroomReview.unknownSubjectOrTeacher');
    }
    return {
      subjectName: new Map(subjects.map((subject) => [String(subject._id), subject.nameLo])),
      teacherName: new Map(
        teachers.map((teacher) => [
          String(teacher._id),
          `${teacher.firstNameLo ?? ''} ${teacher.lastNameLo ?? ''}`.trim(),
        ]),
      ),
    };
  }

  private entryOf(saved: HomeroomMonthlyReportDocument | null): MonthlyReportEntry {
    return {
      overview: saved?.overview ?? null,
      suggestions: saved?.suggestions ?? null,
      extraClasses: (saved?.extraClasses ?? []).map((row) => ({
        studentId: String(row.studentId),
        studentNameLo: row.studentNameLo ?? null,
        subjectId: row.subjectId ? String(row.subjectId) : null,
        subject: row.subject,
        teacherId: row.teacherId ? String(row.teacherId) : null,
        teacherName: row.teacherName ?? null,
      })),
      outsideActivities: (saved?.outsideActivities ?? []).map((row) => ({
        studentId: String(row.studentId),
        studentNameLo: row.studentNameLo ?? null,
        date: row.date ? row.date.toISOString().slice(0, 10) : null,
        detail: row.detail,
      })),
      guardianContacts: (saved?.guardianContacts ?? []).map((row) => ({
        studentId: row.studentId ? String(row.studentId) : null,
        allStudents: Boolean(row.allStudents),
        studentNameLo: row.studentNameLo ?? null,
        date: row.date.toISOString().slice(0, 10),
        content: row.content,
      })),
    };
  }

  private submissionOf(
    ctx: ReportContext,
    saved: HomeroomMonthlyReportDocument | null,
    now: Date,
  ): MonthlyReportSubmission {
    const first = saved?.firstSubmittedAt ?? null;
    const status = reportStatus(ctx.year, ctx.month, first, now);
    return {
      status,
      dueDate: reportDueDate(ctx.year, ctx.month),
      opensAt: reportOpensAt(ctx.year, ctx.month).toISOString(),
      canSubmit: now >= reportOpensAt(ctx.year, ctx.month),
      firstSubmittedAt: first ? first.toISOString() : null,
      lastSubmittedAt: saved?.lastSubmittedAt ? saved.lastSubmittedAt.toISOString() : null,
      daysLate: status === 'pending' ? 0 : daysLate(ctx.year, ctx.month, first, now),
      hasDraft: Boolean(saved),
    };
  }

  private semesterView(ctx: ReportContext): MonthlyReport['semester'] {
    return {
      id: ctx.semester._id.toString(),
      number: ctx.semester.number,
      nameLo: ctx.semester.nameLo ?? null,
    };
  }

  /**
   * The room, term, month and roster every read and write here needs — and the
   * access rule. Reading is the homeroom teacher's own rooms, or any room for the
   * office; writing additionally needs a homeroom teacher on the room to credit
   * the report to, and a teacher may only write for a room that is theirs.
   */
  private async context(
    query: MonthlyReportQueryDto,
    actor: AuthenticatedUser,
    options: { forWriting?: boolean } = {},
  ): Promise<ReportContext> {
    const room = await this.classrooms
      .findOne({ _id: new Types.ObjectId(query.classroomId), deletedAt: null })
      .populate([
        { path: 'gradeLevelId', select: 'code' },
        { path: 'homeroomTeacherId', select: 'firstNameLo lastNameLo' },
      ])
      .lean()
      .exec();
    if (!room) throw AppException.notFound();

    // A homeroom teacher reads their own rooms; the office reads every room.
    const mine = await this.scope.homeroomClassroomIds(actor);
    if (mine !== null && !mine.some((id) => id.equals(room._id))) {
      throw AppException.forbidden('homeroomReview.notHomeroomTeacher');
    }
    const homeroomTeacher = room.homeroomTeacherId as unknown as {
      _id: Types.ObjectId;
      firstNameLo?: string;
      lastNameLo?: string;
    } | null;
    if (options.forWriting) {
      if (!homeroomTeacher) throw AppException.badRequest('homeroomReview.noHomeroomTeacher');
      // A teacher holding a school-wide permission still writes as the room's
      // homeroom teacher, so the room has to be theirs.
      if (
        mine === null &&
        actor.personType === 'teacher' &&
        actor.personId &&
        !homeroomTeacher._id.equals(actor.personId)
      ) {
        throw AppException.forbidden('homeroomReview.notHomeroomTeacher');
      }
    }

    const semester = query.semesterId
      ? await this.semesters.findOne(query.semesterId)
      : await this.semesters.getActiveOrFail();
    const range = monthRange(semester, query.month);
    if (!range) throw AppException.badRequest('homeroomReview.monthNotInSemester');

    return {
      room,
      homeroomTeacher,
      semester,
      range,
      month: query.month,
      year: range.from.getUTCFullYear(),
      roster: await this.roster(room._id),
    };
  }

  /** The derived sections, read live from the records. */
  private async generate(ctx: ReportContext): Promise<MonthlyReport> {
    const { room, semester, range, roster } = ctx;
    const classroomId = room._id.toString();
    const semesterId = semester._id.toString();
    const ids = roster.map((student) => new Types.ObjectId(student.studentId));
    const inMonth = { $gte: range.from, $lte: range.to };

    const [attendance, notes, behavior, deductions, yearDeductions, reviews, classMonth] =
      await Promise.all([
        this.attendances.getClassroomSummary(classroomId, semesterId, { month: ctx.month }),
        this.attendanceModel
          .find({
            classroomId: room._id,
            semesterId: semester._id,
            date: inMonth,
            status: { $ne: 'present' },
            deletedAt: null,
          })
          .select('studentId status reason')
          .lean()
          .exec(),
        this.behaviorModel
          .find({
            classroomId: room._id,
            studentId: { $ne: null },
            date: inMonth,
            deletedAt: null,
          })
          .select('studentId date behavior action')
          .lean()
          .exec(),
        this.deductionModel
          .find({ studentId: { $in: ids }, date: inMonth, deletedAt: null })
          .select('studentId date ruleCode ruleNameLo points note')
          .lean()
          .exec(),
        // The ladder is climbed on the year's running total, so the rung a child
        // stood on before the month and after it both need the year to date.
        this.deductionModel
          .aggregate<{ _id: Types.ObjectId; before: number; byEnd: number }>([
            {
              $match: {
                studentId: { $in: ids },
                schoolYearId: semester.schoolYearId,
                date: { $lte: range.to },
                deletedAt: null,
              },
            },
            {
              $group: {
                _id: '$studentId',
                before: { $sum: { $cond: [{ $lt: ['$date', range.from] }, '$points', 0] } },
                byEnd: { $sum: '$points' },
              },
            },
          ])
          .exec(),
        this.reviews
          .find({ classroomId: room._id, dueDate: inMonth, deletedAt: null })
          .select('dueDate students')
          .lean()
          .exec(),
        this.monthlyMarks.getClassMonth({ classroomId, semesterId, month: ctx.month }),
      ]);

    const conduct: ConductStanding[] = yearDeductions.map((row) => ({
      studentId: row._id.toString(),
      deductedBefore: row.before,
      deductedByEnd: row.byEnd,
      levelBefore: escalationFor(row.before).level,
      levelByEnd: escalationFor(row.byEnd).level,
    }));

    const body = buildMonthlyReport({
      roster,
      attendance: attendance.map((row) => ({
        studentId: row.studentId,
        late: row.late,
        lateAsAbsent: row.lateAsAbsent,
        absentUnexcused: row.absentUnexcused,
        absentExcused: row.absentExcused,
        absentTotal: row.absentTotal,
      })),
      attendanceNotes: notes.map((row) => ({
        studentId: String(row.studentId),
        status: row.status as AttendanceNote['status'],
        reason: row.reason ?? null,
      })),
      behavior: behavior.map((row) => ({
        studentId: String(row.studentId),
        date: row.date.toISOString().slice(0, 10),
        behavior: row.behavior ?? null,
        action: row.action ?? null,
      })),
      deductions: deductions.map((row) => ({
        studentId: String(row.studentId),
        date: row.date.toISOString().slice(0, 10),
        ruleCode: row.ruleCode,
        ruleNameLo: row.ruleNameLo,
        points: row.points,
        note: row.note ?? null,
      })),
      conduct,
      reviews: reviews.flatMap((review) =>
        (review.students ?? []).map((line) => ({
          studentId: String(line.studentId),
          dueDate: review.dueDate.toISOString().slice(0, 10),
          action: line.action,
          contactChannel: line.contactChannel ?? null,
          note: line.note ?? null,
        })),
      ),
      subjects: classMonth.subjects.map((subject) => ({
        id: subject.id,
        nameLo: subject.nameLo,
        testMax: subject.testMax,
      })),
      tests: classMonth.rows.map((row) => ({
        studentId: row.studentId,
        testScores: row.testScores,
      })),
    });

    const grade = room.gradeLevelId as unknown as { _id?: Types.ObjectId; code?: string } | null;
    const teacher = ctx.homeroomTeacher;

    return {
      classroom: {
        id: classroomId,
        name: room.name,
        gradeLevelId: grade?._id ? String(grade._id) : null,
        gradeLevelCode: grade?.code ?? null,
        teacherName: teacher
          ? `${teacher.firstNameLo ?? ''} ${teacher.lastNameLo ?? ''}`.trim() || null
          : null,
      },
      semester: {
        id: semesterId,
        number: semester.number,
        nameLo: semester.nameLo ?? null,
      },
      month: ctx.month,
      year: ctx.year,
      monthNameLo: LAO_MONTHS[ctx.month] ?? String(ctx.month),
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
      ...body,
    };
  }

  /** The class as it stands today, with the gender the ຍິງ count needs. */
  private async roster(classroomId: Types.ObjectId): Promise<ReportStudent[]> {
    const rows = await this.enrollments
      .find({ classroomId, status: 'active', deletedAt: null })
      .populate('studentId', `${ROSTER_STUDENT_SELECT} gender`)
      .sort({ rollNumber: 1 })
      .lean()
      .exec();

    return rows
      .filter((row) => isOnCurrentRoll(row.studentId))
      .map((row) => {
        const student = populatedStudent(row.studentId);
        return {
          studentId: student?._id.toString() ?? String(row.studentId),
          studentCode: row.studentCode ?? null,
          studentNameLo: row.studentNameLo ?? registerName(student),
          rollNumber: row.rollNumber ?? null,
          isFemale: (student as { gender?: string } | null)?.gender === 'female',
        };
      });
  }
}

/**
 * The calendar month inside the term, as UTC midnights — or `null` when the
 * term never touches it.
 *
 * A term runs across a new year (ກັນຍາ–ມັງກອນ), so the year is the one in which
 * that month overlaps the term rather than the year the term began in.
 */
export function monthRange(
  semester: Pick<SemesterDocument, 'startDate' | 'endDate'>,
  month: number,
): { from: Date; to: Date } | null {
  const start = new Date(semester.startDate);
  const end = new Date(semester.endDate);
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));
    if (from <= end && to >= start) return { from, to };
  }
  return null;
}
