import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { isCurrentRollStatus } from 'src/common/utils/current-roll';
import {
  BehaviorLog,
  BehaviorLogDocument,
  Classroom,
  ClassroomDocument,
  Enrollment,
  EnrollmentDocument,
  Guardian,
  GuardianDocument,
  GuardianReport,
  GuardianReportDocument,
  SemesterDocument,
  Student,
  StudentDocument,
  Teacher,
  TeacherDocument,
} from 'src/database/schemas';
import { AttendancesService } from '../attendances/attendances.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ConductDeductionsService } from '../conduct-deductions/conduct-deductions.service';
import { MonthlyMarksService } from '../monthly-marks/monthly-marks.service';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import type {
  CreateGuardianReportDto,
  GuardianReportDraftQueryDto,
  OpenGuardianReportDto,
  QueryGuardianReportsDto,
} from './dto/guardian-report.dto';
import {
  GUARDIAN_REPORT_SECTIONS,
  hashToken,
  isWellFormedToken,
  issueToken,
  LINK_DAYS_SETTING,
  linkExpiry,
  MAX_PIN_ATTEMPTS,
  monthWindow,
  normalizeLinkDays,
  phonePin,
  pinMatches,
  reportState,
  type GuardianReportSection,
  type GuardianReportSnapshot,
} from './guardian-report-rules';

const ENTITY = 'guardian-reports';

/** One register entry, with the id the teacher ticks it by. */
type DraftBehaviorEntry = NonNullable<GuardianReportSnapshot['behavior']>[number] & {
  id: string;
};

/** Everything a report is about, resolved and authorized once. */
interface ReportContext {
  student: StudentDocument;
  classroom: ClassroomDocument;
  semester: SemesterDocument;
  month: number;
  window: { from: Date; to: Date };
  /** The room's homeroom teacher, whoever pressed send. */
  teacherName: string;
  sentBy: GuardianReportSnapshot['sentBy'];
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * ລາຍງານຫາຜູ້ປົກຄອງ — see `GuardianReport` for why it is a frozen snapshot behind
 * a hashed token and the guardian's phone digits.
 *
 * The figures are not aggregated here. Each section is read through the service
 * that owns it — the same calls the student page and the homeroom sheet make — so
 * a guardian is never shown a number the school's own screens disagree with.
 */
@Injectable()
export class GuardianReportsService {
  constructor(
    @InjectModel(GuardianReport.name) private readonly model: Model<GuardianReportDocument>,
    @InjectModel(Student.name) private readonly students: Model<StudentDocument>,
    @InjectModel(Guardian.name) private readonly guardians: Model<GuardianDocument>,
    @InjectModel(Classroom.name) private readonly classrooms: Model<ClassroomDocument>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<EnrollmentDocument>,
    @InjectModel(BehaviorLog.name) private readonly behaviorLogs: Model<BehaviorLogDocument>,
    @InjectModel(Teacher.name) private readonly teachers: Model<TeacherDocument>,
    private readonly semesters: SemestersService,
    private readonly monthlyMarks: MonthlyMarksService,
    private readonly attendances: AttendancesService,
    private readonly conduct: ConductDeductionsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * What the report would say, every section filled, and who it could go to.
   *
   * The teacher reads this before sending: it is the preview, and the place they
   * untick a register entry that names another child.
   */
  async draft(query: GuardianReportDraftQueryDto, actor: AuthenticatedUser) {
    const ctx = await this.context(query, actor);
    const content = await this.assemble(ctx, [...GUARDIAN_REPORT_SECTIONS], actor);

    const linked = await this.guardians
      .find({
        _id: { $in: ctx.student.guardians.map((link) => link.guardianId) },
        deletedAt: null,
      })
      .lean()
      .exec();
    const byId = new Map(linked.map((guardian) => [guardian._id.toString(), guardian]));

    return {
      student: content.student,
      classroomName: content.classroomName,
      semester: content.semester,
      month: ctx.month,
      window: content.window,
      teacherName: ctx.teacherName,
      sentBy: ctx.sentBy,
      monthlyMarks: content.monthlyMarks,
      attendance: content.attendance,
      conduct: content.conduct,
      behavior: content.behavior,
      // Every linked guardian, including the ones a report cannot go to, so the
      // dialog can say why rather than leave the teacher wondering where they went.
      guardians: ctx.student.guardians.flatMap((link) => {
        const guardian = byId.get(link.guardianId.toString());
        if (!guardian) return [];
        return [
          {
            id: guardian._id.toString(),
            nameLo: `${guardian.firstNameLo} ${guardian.lastNameLo}`.trim(),
            relationship: link.relationship,
            isPrimary: link.isPrimary,
            canViewRecords: link.canViewRecords,
            hasPhone: phonePin(guardian.phone) !== null,
          },
        ];
      }),
    };
  }

  /**
   * Sends one: assembles the report again from the source, freezes it, and hands
   * back the token — the only time it exists outside the guardian's link.
   */
  async create(dto: CreateGuardianReportDto, actor: AuthenticatedUser, ip: string | null) {
    const sections = GUARDIAN_REPORT_SECTIONS.filter((section) => dto.sections.includes(section));
    const message = dto.message?.trim() || null;
    if (sections.length === 0 && !message) throw AppException.badRequest('guardianReport.empty');

    const ctx = await this.context(dto, actor);
    const guardian = await this.recipient(ctx.student, dto.guardianId);
    if (!guardian) throw AppException.badRequest('guardianReport.guardianNotLinked');
    if (phonePin(guardian.phone) === null) {
      throw AppException.badRequest('guardianReport.guardianHasNoPhone');
    }

    const content = await this.assemble(ctx, sections, actor);
    const chosen = new Set(dto.behaviorLogIds ?? []);
    const link = ctx.student.guardians.find((entry) => entry.guardianId.equals(guardian._id))!;

    const snapshot: GuardianReportSnapshot = {
      student: content.student,
      classroomName: content.classroomName,
      semester: content.semester,
      month: ctx.month,
      window: content.window,
      teacherName: ctx.teacherName,
      sentBy: ctx.sentBy,
      guardian: {
        nameLo: `${guardian.firstNameLo} ${guardian.lastNameLo}`.trim(),
        relationship: link.relationship,
      },
      sections,
      ...(sections.includes('monthlyMarks') ? { monthlyMarks: content.monthlyMarks } : {}),
      ...(sections.includes('attendance') ? { attendance: content.attendance } : {}),
      ...(sections.includes('conduct') ? { conduct: content.conduct } : {}),
      ...(sections.includes('behavior')
        ? {
            // Only what was ticked, and only from this child's month — an id
            // from anywhere else is not in `content` to be picked.
            behavior: (content.behavior ?? [])
              .filter((entry) => chosen.has(entry.id))
              .map(({ id: _id, ...entry }) => entry),
          }
        : {}),
      message,
      generatedAt: new Date().toISOString(),
    };

    const { token, tokenHash } = issueToken();
    const now = new Date();
    const created = await this.model.create({
      studentId: ctx.student._id,
      guardianId: guardian._id,
      classroomId: ctx.classroom._id,
      semesterId: ctx.semester._id,
      schoolYearId: ctx.semester.schoolYearId,
      month: ctx.month,
      tokenHash,
      expiresAt: linkExpiry(now, await this.linkDays()),
      snapshot,
      teacherId: ctx.classroom.homeroomTeacherId ?? null,
      createdBy: new Types.ObjectId(actor.sub),
    });

    await this.audit.record({
      action: 'create',
      entityType: ENTITY,
      entityId: created._id.toString(),
      userId: actor.sub,
      username: actor.username,
      // Never the token: the audit log is read by more people than the link was.
      newValue: {
        studentId: ctx.student._id.toString(),
        guardianId: guardian._id.toString(),
        month: ctx.month,
        sections,
        behaviorEntries: snapshot.behavior?.length ?? 0,
        expiresAt: created.expiresAt.toISOString(),
      },
      ip,
    });

    return { report: this.toView(created, now), token };
  }

  /** What has been sent about one child, newest first. */
  async list(query: QueryGuardianReportsDto, actor: AuthenticatedUser) {
    const student = await this.findStudent(query.studentId);
    if (!this.oversees(actor)) {
      const placement = await this.currentPlacement(student._id);
      if (!placement) throw AppException.forbidden('guardianReport.notHomeroomTeacher');
      await this.assertHomeroomOf(placement.classroomId, actor);
    }

    const rows = await this.model
      .find({ studentId: student._id, deletedAt: null })
      .sort({ createdAt: -1 })
      .exec();
    const now = new Date();
    return rows.map((row) => this.toView(row, now));
  }

  /**
   * A new link for a report already sent — lost, or locked by a guardian who
   * mistyped. The old link stops working, the content does not change, and the
   * guesses and the expiry start again.
   */
  async reissue(id: string, actor: AuthenticatedUser, ip: string | null) {
    const report = await this.findReport(id);
    if (!this.oversees(actor)) await this.assertHomeroomOf(report.classroomId, actor);
    if (report.revokedAt) throw AppException.badRequest('guardianReport.revoked');

    const { token, tokenHash } = issueToken();
    const now = new Date();
    report.tokenHash = tokenHash;
    report.failedAttempts = 0;
    report.lockedAt = null;
    report.expiresAt = linkExpiry(now, await this.linkDays());
    await report.save();

    await this.audit.record({
      action: 'update',
      entityType: ENTITY,
      entityId: report._id.toString(),
      userId: actor.sub,
      username: actor.username,
      newValue: { reissued: true, expiresAt: report.expiresAt.toISOString() },
      ip,
    });

    return { report: this.toView(report, now), token };
  }

  /** Stops a link for good. The homeroom teacher, or the office overseeing them. */
  async revoke(id: string, actor: AuthenticatedUser, ip: string | null) {
    const report = await this.findReport(id);
    if (!this.oversees(actor)) await this.assertHomeroomOf(report.classroomId, actor);

    const now = new Date();
    if (!report.revokedAt) {
      report.revokedAt = now;
      report.revokedBy = new Types.ObjectId(actor.sub);
      await report.save();

      await this.audit.record({
        action: 'lock',
        entityType: ENTITY,
        entityId: report._id.toString(),
        userId: actor.sub,
        username: actor.username,
        newValue: { revokedAt: now.toISOString() },
        reason: 'revoked',
        ip,
      });
    }

    return this.toView(report, now);
  }

  /**
   * The guardian's side: no account, a token and four digits.
   *
   * Every way a link can be dead — unknown, expired, revoked, a child who has
   * left, a guardian unlinked — answers the same `unavailable`, so the page tells
   * a stranger nothing about which. Locked is said separately because it is the
   * one the guardian can do something about: ask the teacher for a new link.
   */
  async open(dto: OpenGuardianReportDto, ip: string | null) {
    if (!isWellFormedToken(dto.token)) throw AppException.notFound('guardianReport.unavailable');

    const report = await this.model
      .findOne({ tokenHash: hashToken(dto.token), deletedAt: null })
      .exec();
    if (!report) throw AppException.notFound('guardianReport.unavailable');

    const now = new Date();
    const state = reportState(report, now);
    if (state === 'locked') throw AppException.forbidden('guardianReport.locked');
    if (state !== 'active') throw AppException.notFound('guardianReport.unavailable');

    const guardian = await this.liveRecipient(report);
    if (!guardian) throw AppException.notFound('guardianReport.unavailable');

    // A guess is paid for before it is checked. Reserving the attempt atomically
    // is what holds the count to five when a script fires fifty at once — a
    // read-compare-increment would let every one of them through the read.
    const reserved = await this.model
      .findOneAndUpdate(
        {
          _id: report._id,
          revokedAt: null,
          lockedAt: null,
          failedAttempts: { $lt: MAX_PIN_ATTEMPTS },
        },
        { $inc: { failedAttempts: 1 } },
        { new: true },
      )
      .exec();
    if (!reserved) throw AppException.forbidden('guardianReport.locked');

    if (!pinMatches(dto.pin, guardian.phone)) {
      const attemptsLeft = MAX_PIN_ATTEMPTS - reserved.failedAttempts;
      if (attemptsLeft > 0) {
        throw AppException.badRequest('guardianReport.wrongPin', { attemptsLeft });
      }
      await this.model.updateOne({ _id: report._id, lockedAt: null }, { $set: { lockedAt: now } });
      await this.audit.record({
        action: 'lock',
        entityType: ENTITY,
        entityId: report._id.toString(),
        reason: 'too many wrong phone digits',
        ip,
      });
      throw AppException.forbidden('guardianReport.locked');
    }

    // The right digits hand the reserved attempt back.
    await this.model.updateOne(
      { _id: report._id },
      { $inc: { failedAttempts: -1, viewCount: 1 }, $set: { lastViewedAt: now } },
    );
    await this.model.updateOne(
      { _id: report._id, firstViewedAt: null },
      { $set: { firstViewedAt: now } },
    );
    await this.audit.record({
      action: 'read',
      entityType: ENTITY,
      entityId: report._id.toString(),
      reason: 'opened by guardian link',
      ip,
    });

    return {
      schoolNameLo: (await this.settings.getValue<string>('school.nameLo')) ?? null,
      expiresAt: report.expiresAt.toISOString(),
      report: report.snapshot as unknown as GuardianReportSnapshot,
    };
  }

  // ── Context and authorization ─────────────────────────────────────────────

  /**
   * The child, their room this year, the term and the month — and who may send:
   * the room's ຄູປະຈຳຫ້ອງ, or the office (`manage`). Another teacher may not,
   * however many of the child's lessons they teach.
   *
   * The report names the room's homeroom teacher either way, because that is the
   * person the family knows; `sentBy` says when the office sent it for them.
   */
  private async context(
    query: GuardianReportDraftQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ReportContext> {
    const student = await this.findStudent(query.studentId);
    if (!isCurrentRollStatus(student.status)) {
      throw AppException.badRequest('guardianReport.studentNotEnrolled');
    }

    const semester = query.semesterId
      ? await this.semesters.findOne(query.semesterId)
      : await this.semesters.getActiveOrFail();

    const window = monthWindow(semester, query.month);
    if (!window) {
      throw AppException.badRequest('guardianReport.monthOutsideTerm', { month: query.month });
    }

    const placement = await this.enrollments
      .findOne({
        studentId: student._id,
        schoolYearId: semester.schoolYearId,
        status: 'active',
        deletedAt: null,
      })
      .sort({ enrolledAt: -1 })
      .exec();
    if (!placement) throw AppException.badRequest('guardianReport.studentNotEnrolled');

    const classroom = await this.authorizeSend(placement.classroomId, actor);
    const teacher = classroom.homeroomTeacherId
      ? await this.teachers.findById(classroom.homeroomTeacherId).lean().exec()
      : null;
    const isHomeroom =
      actor.personType === 'teacher' && String(classroom.homeroomTeacherId) === actor.personId;

    return {
      student,
      classroom,
      semester,
      month: query.month,
      window,
      teacherName: teacher ? `${teacher.firstNameLo} ${teacher.lastNameLo}`.trim() : '',
      sentBy: isHomeroom ? 'homeroom' : 'office',
    };
  }

  /** The office sends for any room; anybody else only for the room they are ຄູປະຈຳຫ້ອງ of. */
  private async authorizeSend(
    classroomId: Types.ObjectId,
    actor: AuthenticatedUser,
  ): Promise<ClassroomDocument> {
    if (!this.oversees(actor)) return this.assertHomeroomOf(classroomId, actor);
    const classroom = await this.classrooms.findOne({ _id: classroomId, deletedAt: null }).exec();
    if (!classroom) throw AppException.notFound();
    return classroom;
  }

  private async assertHomeroomOf(
    classroomId: Types.ObjectId,
    actor: AuthenticatedUser,
  ): Promise<ClassroomDocument> {
    const classroom = await this.classrooms.findOne({ _id: classroomId, deletedAt: null }).exec();
    if (
      !classroom ||
      actor.personType !== 'teacher' ||
      !actor.personId ||
      String(classroom.homeroomTeacherId) !== actor.personId
    ) {
      throw AppException.forbidden('guardianReport.notHomeroomTeacher');
    }
    return classroom;
  }

  /** `guardian-reports:manage` — the office: sends, reads and revokes for every room. */
  private oversees(actor: AuthenticatedUser): boolean {
    return actor.permissions.some(
      (grant) => grant.resource === 'guardian-reports' && grant.actions.includes('manage'),
    );
  }

  private async findStudent(id: string): Promise<StudentDocument> {
    const student = await this.students
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .exec();
    if (!student) throw AppException.notFound();
    return student;
  }

  private async findReport(id: string): Promise<GuardianReportDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const report = await this.model
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .exec();
    if (!report) throw AppException.notFound();
    return report;
  }

  private async currentPlacement(studentId: Types.ObjectId) {
    return this.enrollments
      .findOne({ studentId, status: 'active', deletedAt: null })
      .sort({ enrolledAt: -1 })
      .lean()
      .exec();
  }

  /** A guardian this child lists with `canViewRecords`, or `null`. */
  private async recipient(
    student: StudentDocument,
    guardianId: string | Types.ObjectId,
  ): Promise<GuardianDocument | null> {
    const link = student.guardians.find(
      (entry) => String(entry.guardianId) === String(guardianId) && entry.canViewRecords,
    );
    if (!link) return null;
    return this.guardians.findOne({ _id: link.guardianId, deletedAt: null }).exec();
  }

  /**
   * The addressee as things stand now, or `null` if the link should no longer
   * open: the child left the roll, or the guardian was unlinked or lost
   * `canViewRecords` since it was sent. Read on every open so none of that needs
   * anybody to remember to revoke.
   */
  private async liveRecipient(report: GuardianReportDocument): Promise<GuardianDocument | null> {
    const student = await this.students.findOne({ _id: report.studentId, deletedAt: null }).exec();
    if (!student || !isCurrentRollStatus(student.status)) return null;
    return this.recipient(student, report.guardianId);
  }

  private async linkDays(): Promise<number> {
    return normalizeLinkDays(await this.settings.getValue(LINK_DAYS_SETTING));
  }

  // ── Content ───────────────────────────────────────────────────────────────

  /** Each section through the service that owns its numbers. */
  private async assemble(
    ctx: ReportContext,
    sections: GuardianReportSection[],
    actor: AuthenticatedUser,
  ) {
    const studentId = ctx.student._id.toString();
    const want = (section: GuardianReportSection) => sections.includes(section);
    const from = iso(ctx.window.from);
    const to = iso(ctx.window.to);

    const [marks, attendance, ledger, behavior] = await Promise.all([
      want('monthlyMarks')
        ? this.monthlyMarks.getStudentMonths(
            { studentId, semesterId: ctx.semester._id.toString() },
            actor,
          )
        : null,
      want('attendance')
        ? this.attendances.getStudentSummary(studentId, ctx.semester._id.toString(), undefined, {
            from,
            to,
          })
        : null,
      want('conduct')
        ? this.conduct.getStudentLedger(studentId, ctx.semester.schoolYearId.toString(), actor)
        : null,
      want('behavior') ? this.behaviorEntries(ctx) : null,
    ]);

    const monthEntry = marks?.monthly.find((entry) => entry.month === ctx.month);

    return {
      student: {
        nameLo: `${ctx.student.firstNameLo} ${ctx.student.lastNameLo}`.trim(),
        nickname: ctx.student.nickname ?? null,
      },
      classroomName: ctx.classroom.name,
      semester: { number: ctx.semester.number, nameLo: ctx.semester.nameLo ?? null },
      window: { from, to },
      monthlyMarks: marks
        ? {
            subjects: marks.subjects.map((subject, index) => ({
              nameLo: subject.nameLo,
              nameEn: subject.nameEn,
              score: monthEntry?.scores[index] ?? null,
              test: monthEntry?.testScores[index] ?? null,
              grade: monthEntry?.subjectGrades[index] ?? null,
            })),
            total: monthEntry?.total ?? null,
            average: monthEntry?.average ?? null,
            grade: monthEntry?.grade ?? null,
            isComplete: monthEntry?.isComplete ?? false,
          }
        : undefined,
      attendance: attendance
        ? {
            present: attendance.present,
            absent: attendance.absent,
            late: attendance.late,
            excused: attendance.excused,
            sick: attendance.sick,
            totalRecorded: attendance.totalRecorded,
            absentUnexcused: attendance.absentUnexcused,
            absentExcused: attendance.absentExcused,
            latesPerAbsence: attendance.latesPerAbsence,
            attendanceRate: attendance.attendanceRate,
          }
        : undefined,
      conduct: ledger
        ? {
            baseScore: ledger.baseScore,
            remaining: ledger.remaining,
            grade: ledger.grade ?? null,
            deductions: ledger.entries
              .filter((entry) => entry.date >= from && entry.date <= to)
              .map((entry) => ({
                date: entry.date,
                ruleNameLo: entry.ruleNameLo,
                points: entry.points,
              })),
          }
        : undefined,
      behavior: behavior ?? undefined,
    };
  }

  /**
   * The child's own register lines for the month. Never the ສະພາບລວມ class note:
   * it is about the room, and it is the line most likely to name somebody else.
   */
  private async behaviorEntries(ctx: ReportContext): Promise<DraftBehaviorEntry[]> {
    const rows = await this.behaviorLogs
      .find({
        studentId: ctx.student._id,
        date: { $gte: ctx.window.from, $lte: ctx.window.to },
        deletedAt: null,
      })
      .populate('subjectId', 'nameLo')
      .sort({ date: 1, period: 1 })
      .lean()
      .exec();

    return rows
      .filter((row) => row.behavior || row.action || row.remark)
      .map((row) => ({
        id: row._id.toString(),
        date: iso(row.date),
        subjectNameLo: (row.subjectId as unknown as { nameLo?: string } | null)?.nameLo ?? null,
        behavior: row.behavior ?? null,
        action: row.action ?? null,
        remark: row.remark ?? null,
      }));
  }

  /** The teacher's row. Never the token or its hash. */
  private toView(report: GuardianReportDocument, now: Date) {
    const snapshot = report.snapshot as unknown as GuardianReportSnapshot;
    return {
      id: report._id.toString(),
      studentId: report.studentId.toString(),
      guardianId: report.guardianId.toString(),
      month: report.month,
      semesterId: report.semesterId.toString(),
      state: reportState(report, now),
      expiresAt: report.expiresAt.toISOString(),
      failedAttempts: report.failedAttempts,
      viewCount: report.viewCount,
      firstViewedAt: report.firstViewedAt?.toISOString() ?? null,
      lastViewedAt: report.lastViewedAt?.toISOString() ?? null,
      revokedAt: report.revokedAt?.toISOString() ?? null,
      createdAt: report.createdAt?.toISOString() ?? null,
      snapshot,
    };
  }
}
