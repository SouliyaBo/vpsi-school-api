import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ExamLevel } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { toApiDocuments } from 'src/common/utils/serialize';
import {
  Enrollment,
  EnrollmentDocument,
  ExamRegistration,
  ExamRegistrationDocument,
  ExamResult,
  ExamResultDocument,
  GradeLevel,
  GradeLevelDocument,
  Student,
  StudentDocument,
  TermResult,
  TermResultDocument,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AttendancesService } from '../attendances/attendances.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import { round2 } from '../term-results/grading';
import {
  ApproveExamRegistrationDto,
  CreateExamRegistrationDto,
  QueryExamRegistrationsDto,
  QueryExamResultsDto,
  RecordExamResultDto,
  RejectExamRegistrationDto,
} from './dto/exam.dto';
import {
  DEFAULT_ELIGIBILITY_RULES,
  EligibilityOutcome,
  EligibilityRules,
  checkEligibility,
} from './eligibility';

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    @InjectModel(ExamRegistration.name)
    private readonly registrationModel: Model<ExamRegistrationDocument>,
    @InjectModel(ExamResult.name) private readonly resultModel: Model<ExamResultDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevelDocument>,
    @InjectModel(TermResult.name) private readonly termResultModel: Model<TermResultDocument>,
    private readonly attendances: AttendancesService,
    private readonly schoolYears: SchoolYearsService,
    private readonly semesters: SemestersService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
    private readonly tx: TransactionHelper,
    private readonly scope: RecordScopeService,
  ) {}

  // ── Registrations ─────────────────────────────────────────────────────────

  async findRegistrations(
    query: QueryExamRegistrationsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ExamRegistrationDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.level) filter.level = query.level;
    if (query.status) filter.status = query.status;

    await this.scope.applyStudentScope(filter, actor);

    const [data, total] = await Promise.all([
      this.registrationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.registrationModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as ExamRegistrationDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  async findRegistration(id: string): Promise<ExamRegistrationDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const registration = await this.registrationModel.findOne({ _id: id, deletedAt: null }).exec();
    if (!registration) throw AppException.notFound();
    return registration;
  }

  /**
   * Evaluates eligibility without registering.
   *
   * Exposed as its own endpoint so a registrar can see *why* a student is
   * blocked before attempting a registration that will be rejected.
   */
  async checkStudentEligibility(
    studentId: string,
    level: ExamLevel,
    semesterId?: string,
  ): Promise<EligibilityOutcome> {
    const rules = await this.resolveRules();

    const student = await this.studentModel.findById(studentId).lean().exec();
    if (!student) throw AppException.notFound('common.notFound', { field: 'studentId' });

    const schoolYear = await this.schoolYears.getActiveOrFail();
    const semester = semesterId
      ? await this.semesters.findOneOrFail(semesterId)
      : await this.semesters.getActiveOrFail();

    const enrollment = await this.enrollmentModel
      .findOne({
        studentId: student._id,
        schoolYearId: schoolYear._id,
        status: 'active',
        deletedAt: null,
      })
      .lean()
      .exec();

    const gradeLevel = enrollment
      ? await this.gradeLevelModel.findById(enrollment.gradeLevelId).lean().exec()
      : null;

    const [termResult, attendance] = await Promise.all([
      this.termResultModel
        .findOne({
          studentId: student._id,
          semesterId: semester._id,
          deletedAt: null,
        })
        .lean()
        .exec(),
      this.attendances.getStudentSummary(studentId, semester._id.toString()),
    ]);

    const outcome = checkEligibility(
      {
        level,
        gradeLevelCode: gradeLevel?.code ?? '',
        enrollmentStatus: enrollment?.status ?? 'none',
        studentStatus: student.status,
        // With nothing recorded, treat attendance as full rather than as zero —
        // otherwise every student is ineligible before the first roll call.
        attendanceRate: attendance.totalRecorded === 0 ? 100 : attendance.attendanceRate,
        subjectsFailed: termResult?.subjectsFailed ?? 0,
        hasProvisionalResult: termResult?.isProvisional ?? false,
        hasNoResult: !termResult,
      },
      rules,
    );

    return {
      ...outcome,
      snapshot: { ...outcome.snapshot, checkedAt: new Date().toISOString() },
    };
  }

  /**
   * Registers a student for a national exam.
   *
   * Ineligible students are refused unless an authorized caller passes
   * `overrideIneligible` with a reason — schools do have legitimate exceptional
   * cases, and forcing them outside the system would lose the audit trail.
   */
  async createRegistration(
    dto: CreateExamRegistrationDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<ExamRegistrationDocument> {
    const student = await this.studentModel.findById(dto.studentId).lean().exec();
    if (!student) throw AppException.badRequest('common.notFound', { field: 'studentId' });

    const schoolYear = dto.schoolYearId
      ? await this.schoolYears.findOneOrFail(dto.schoolYearId)
      : await this.schoolYears.getActiveOrFail();

    const eligibility = await this.checkStudentEligibility(
      dto.studentId,
      dto.level,
      dto.semesterId,
    );

    if (!eligibility.isEligible) {
      const canOverride = actor.permissions.some(
        (p) => p.resource === 'exams' && p.actions.includes('manage'),
      );

      if (!dto.overrideIneligible) {
        throw AppException.unprocessable('common.validationFailed', {
          reason: 'student is not eligible for this exam',
          failedChecks: eligibility.failedChecks,
        });
      }
      if (!canOverride) {
        throw AppException.forbidden('auth.forbidden', {
          reason: 'overriding eligibility requires exams:manage',
        });
      }
      if (!dto.overrideReason?.trim()) {
        throw AppException.badRequest('common.validationFailed', {
          field: 'overrideReason',
          reason: 'a reason is required when overriding eligibility',
        });
      }
    }

    const existing = await this.registrationModel
      .findOne({
        studentId: student._id,
        level: dto.level,
        schoolYearId: schoolYear._id,
        deletedAt: null,
      })
      .exec();
    if (existing) {
      throw AppException.conflict('common.duplicate', {
        reason: 'student is already registered for this exam',
        registrationId: existing._id.toString(),
      });
    }

    const created = await this.registrationModel.create({
      studentId: student._id,
      studentCode: student.studentCode,
      studentNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
      level: dto.level,
      schoolYearId: schoolYear._id,
      status: 'pending',
      eligibilitySnapshot: {
        ...eligibility.snapshot,
        overridden: !eligibility.isEligible,
        overrideReason: eligibility.isEligible ? null : (dto.overrideReason ?? null),
        overriddenBy: eligibility.isEligible ? null : actor.username,
      },
    });

    await this.audit.record({
      action: 'create',
      entityType: 'examRegistrations',
      entityId: created._id,
      userId: actor.sub,
      username: actor.username,
      newValue: {
        studentCode: created.studentCode,
        level: created.level,
        wasEligible: eligibility.isEligible,
      },
      ip,
      reason: eligibility.isEligible
        ? null
        : `ELIGIBILITY OVERRIDE: ${dto.overrideReason} (failed: ${eligibility.failedChecks.join(', ')})`,
    });

    return created;
  }

  async approveRegistration(
    id: string,
    dto: ApproveExamRegistrationDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<ExamRegistrationDocument> {
    const registration = await this.findRegistration(id);
    this.assertRegistrationStatus(registration.status, ['pending']);

    const updated = await this.registrationModel
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            status: 'approved',
            examNumber: dto.examNumber,
            examCenter: dto.examCenter ?? null,
            examDate: dto.examDate ? new Date(dto.examDate) : null,
            approvedBy: new Types.ObjectId(actor.sub),
            approvedAt: new Date(),
            rejectionReason: null,
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw AppException.notFound();

    await this.notifyStudentAndGuardians(updated, 'approved');

    await this.audit.record({
      action: 'approve',
      entityType: 'examRegistrations',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { examNumber: dto.examNumber, status: 'approved' },
      ip,
    });

    return updated;
  }

  async rejectRegistration(
    id: string,
    dto: RejectExamRegistrationDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<ExamRegistrationDocument> {
    const registration = await this.findRegistration(id);
    this.assertRegistrationStatus(registration.status, ['pending', 'approved']);

    const updated = await this.registrationModel
      .findOneAndUpdate(
        { _id: id },
        { $set: { status: 'rejected', rejectionReason: dto.reason } },
        { new: true },
      )
      .exec();
    if (!updated) throw AppException.notFound();

    await this.notifyStudentAndGuardians(updated, 'rejected');

    await this.audit.record({
      action: 'reject',
      entityType: 'examRegistrations',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: registration.status },
      newValue: { status: 'rejected' },
      ip,
      reason: dto.reason,
    });

    return updated;
  }

  async cancelRegistration(
    id: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<ExamRegistrationDocument> {
    const registration = await this.findRegistration(id);
    this.assertRegistrationStatus(registration.status, ['pending', 'approved']);

    const updated = await this.registrationModel
      .findOneAndUpdate({ _id: id }, { $set: { status: 'cancelled' } }, { new: true })
      .exec();
    if (!updated) throw AppException.notFound();

    await this.audit.record({
      action: 'update',
      entityType: 'examRegistrations',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: registration.status },
      newValue: { status: 'cancelled' },
      ip,
    });

    return updated;
  }

  // ── Results ───────────────────────────────────────────────────────────────

  async findResults(
    query: QueryExamResultsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ExamResultDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.level) filter.level = query.level;
    if (query.isPassed !== undefined) filter.isPassed = query.isPassed;

    await this.scope.applyStudentScope(filter, actor);
    if (this.scope.isScoped(actor)) filter.isPublished = true;

    const [data, total] = await Promise.all([
      this.resultModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.resultModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as ExamResultDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Records the outcome of a national exam.
   *
   * Totals and pass/fail are derived from the per-subject marks rather than
   * accepted from the request, so the stored summary can never disagree with the
   * detail behind it. Marking the registration `completed` happens in the same
   * transaction.
   */
  async recordResult(
    dto: RecordExamResultDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<ExamResultDocument> {
    return this.tx.run(async (session) => {
      const registration = await this.registrationModel
        .findOne({ _id: dto.registrationId, deletedAt: null })
        .session(session)
        .exec();
      if (!registration) {
        throw AppException.badRequest('common.notFound', { field: 'registrationId' });
      }

      // A result only means something for a student who was approved to sit.
      if (registration.status !== 'approved' && registration.status !== 'completed') {
        throw AppException.conflict('common.validationFailed', {
          reason: `cannot record a result for a registration in status "${registration.status}"`,
        });
      }

      const passingPercentage =
        (await this.settings.getValue<number>('exams.passingPercentage')) ?? 50;

      const subjects = dto.subjects.map((subject) => {
        if (subject.score > subject.maxScore) {
          throw AppException.badRequest('score.exceedsMax', {
            subject: subject.subjectNameLo,
            score: subject.score,
            maxScore: subject.maxScore,
          });
        }
        return {
          subjectId: subject.subjectId ? new Types.ObjectId(subject.subjectId) : null,
          subjectNameLo: subject.subjectNameLo,
          score: subject.score,
          maxScore: subject.maxScore,
          isPassed: (subject.score / subject.maxScore) * 100 >= passingPercentage,
        };
      });

      const totalScore = round2(subjects.reduce((sum, s) => sum + s.score, 0));
      const maxTotalScore = round2(subjects.reduce((sum, s) => sum + s.maxScore, 0));
      const percentage = maxTotalScore > 0 ? round2((totalScore / maxTotalScore) * 100) : 0;

      // Every subject must pass — a national exam is not averaged away.
      const isPassed = subjects.every((s) => s.isPassed);

      const existing = await this.resultModel
        .findOne({ registrationId: registration._id, deletedAt: null })
        .session(session)
        .exec();

      const values = {
        registrationId: registration._id,
        studentId: registration.studentId,
        level: registration.level,
        schoolYearId: registration.schoolYearId,
        subjects,
        totalScore,
        maxTotalScore,
        percentage,
        isPassed,
        resultGrade: dto.resultGrade ?? null,
        nationalRank: dto.nationalRank ?? null,
        recordedBy: new Types.ObjectId(actor.sub),
      };

      const saved = existing
        ? await this.resultModel
            .findOneAndUpdate({ _id: existing._id }, { $set: values }, { new: true, session })
            .exec()
        : (await this.resultModel.create([values], { session }))[0];

      await this.registrationModel
        .updateOne({ _id: registration._id }, { $set: { status: 'completed' } }, { session })
        .exec();

      await this.audit.record(
        {
          action: existing ? 'update' : 'create',
          entityType: 'examResults',
          entityId: saved!._id,
          userId: actor.sub,
          username: actor.username,
          oldValue: existing
            ? { totalScore: existing.totalScore, isPassed: existing.isPassed }
            : null,
          newValue: { totalScore, percentage, isPassed },
          ip,
        },
        session,
      );

      return saved!;
    });
  }

  /**
   * Publishes results, which is what makes them visible to students, and
   * notifies everyone affected.
   */
  async publishResults(
    schoolYearId: string,
    level: ExamLevel,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ published: number }> {
    const filter = {
      schoolYearId: new Types.ObjectId(schoolYearId),
      level,
      isPublished: false,
      deletedAt: null,
    };

    const pending = await this.resultModel.find(filter).exec();
    const outcome = await this.resultModel
      .updateMany(filter, { $set: { isPublished: true } })
      .exec();

    for (const result of pending) {
      const userIds = [
        await this.notifications.findUserIdForPerson('student', result.studentId),
        ...(await this.notifications.findGuardianUserIdsForStudent(result.studentId)),
      ].filter((id): id is Types.ObjectId => id !== null);

      await this.notifications.notifyMany(userIds, {
        type: 'exam_result',
        titleLo: 'ຜົນສອບເສັງປະກາດແລ້ວ',
        titleEn: 'Exam results published',
        bodyLo: result.isPassed
          ? `ຍິນດີດ້ວຍ! ສອບເສັງ ${level.toUpperCase()} ຜ່ານ (${result.percentage}%)`
          : `ຜົນສອບເສັງ ${level.toUpperCase()}: ບໍ່ຜ່ານ (${result.percentage}%)`,
        bodyEn: result.isPassed
          ? `Congratulations — ${level.toUpperCase()} exam passed (${result.percentage}%).`
          : `${level.toUpperCase()} exam result: not passed (${result.percentage}%).`,
        data: { entityType: 'examResults', entityId: result._id.toString() },
      });
    }

    await this.audit.record({
      action: 'update',
      entityType: 'examResults',
      userId: actor.sub,
      username: actor.username,
      newValue: { schoolYearId, level, published: outcome.modifiedCount },
      ip,
      reason: 'exam results published',
    });

    return { published: outcome.modifiedCount };
  }

  /** A student's own result, gated on publication. */
  async findResultForStudent(
    studentId: string,
    level: ExamLevel,
    actor: AuthenticatedUser,
  ): Promise<ExamResultDocument> {
    // Before the lookup, so an unreadable student yields the same answer
    // whether or not a result exists.
    await this.scope.assertCanAccessStudent(actor, studentId);

    const result = await this.resultModel
      .findOne({ studentId: new Types.ObjectId(studentId), level, deletedAt: null })
      .exec();
    if (!result) throw AppException.notFound();

    const canSeeUnpublished = actor.permissions.some(
      (p) => p.resource === 'exams' && p.actions.includes('manage'),
    );
    if (!result.isPublished && !canSeeUnpublished) {
      throw AppException.forbidden('termResult.notPublished');
    }

    return result;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private assertRegistrationStatus(current: string, allowed: string[]): void {
    if (!allowed.includes(current)) {
      throw AppException.conflict('common.validationFailed', {
        reason: `registration is "${current}"; expected one of ${allowed.join(', ')}`,
      });
    }
  }

  /** Eligibility thresholds are policy, so they live in settings. */
  private async resolveRules(): Promise<EligibilityRules> {
    const configured = await this.settings.getValue<Partial<EligibilityRules>>('exams.eligibility');
    if (!configured || typeof configured !== 'object') return DEFAULT_ELIGIBILITY_RULES;

    return {
      minAttendanceRate:
        typeof configured.minAttendanceRate === 'number'
          ? configured.minAttendanceRate
          : DEFAULT_ELIGIBILITY_RULES.minAttendanceRate,
      maxSubjectsFailed:
        typeof configured.maxSubjectsFailed === 'number'
          ? configured.maxSubjectsFailed
          : DEFAULT_ELIGIBILITY_RULES.maxSubjectsFailed,
      requiredGradeLevel:
        configured.requiredGradeLevel ?? DEFAULT_ELIGIBILITY_RULES.requiredGradeLevel,
    };
  }

  private async notifyStudentAndGuardians(
    registration: ExamRegistrationDocument,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const userIds = [
      await this.notifications.findUserIdForPerson('student', registration.studentId),
      ...(await this.notifications.findGuardianUserIdsForStudent(registration.studentId)),
    ].filter((id): id is Types.ObjectId => id !== null);

    const approved = outcome === 'approved';
    await this.notifications.notifyMany(userIds, {
      type: 'general',
      titleLo: approved ? 'ການສະໝັກສອບໄດ້ຮັບອະນຸມັດ' : 'ການສະໝັກສອບບໍ່ໄດ້ຮັບອະນຸມັດ',
      titleEn: approved ? 'Exam registration approved' : 'Exam registration rejected',
      bodyLo: approved
        ? `ສອບເສັງ ${registration.level.toUpperCase()} — ເລກທີ່ນັ່ງ: ${registration.examNumber}`
        : `ສອບເສັງ ${registration.level.toUpperCase()}: ${registration.rejectionReason ?? ''}`,
      bodyEn: approved
        ? `${registration.level.toUpperCase()} exam — seat number: ${registration.examNumber}`
        : `${registration.level.toUpperCase()} exam: ${registration.rejectionReason ?? ''}`,
      data: { entityType: 'examRegistrations', entityId: registration._id.toString() },
    });
  }
}
