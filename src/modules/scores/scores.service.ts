import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  Enrollment,
  EnrollmentDocument,
  Score,
  ScoreComponentDocument,
  ScoreDocument,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { ScoreComponentsService } from '../score-components/score-components.service';
import { SemestersService } from '../semesters/semesters.service';
import { TeachingAssignmentsService } from '../teaching-assignments/teaching-assignments.service';
import { TermResultStalenessService } from '../term-results/term-result-staleness.service';
import {
  BatchSaveResultDto,
  BatchSaveScoresDto,
  LockScoresDto,
  QueryScoresDto,
  UnlockScoresDto,
} from './dto/score.dto';

@Injectable()
export class ScoresService {
  private readonly logger = new Logger(ScoresService.name);

  constructor(
    @InjectModel(Score.name) private readonly model: Model<ScoreDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    private readonly components: ScoreComponentsService,
    private readonly assignments: TeachingAssignmentsService,
    private readonly semesters: SemestersService,
    private readonly audit: AuditLogsService,
    private readonly tx: TransactionHelper,
    private readonly scope: RecordScopeService,
    private readonly staleness: TermResultStalenessService,
  ) {}

  async findAll(
    query: QueryScoresDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ScoreDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.componentId) filter.componentId = new Types.ObjectId(query.componentId);
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);

    await this.scope.applyStudentScope(filter, actor);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('componentId', 'nameLo type weight maxScore')
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * The grade-entry grid: every enrolled student with their mark for a component,
   * including students who have no score row yet.
   */
  async getEntryGrid(componentId: string, classroomId: string) {
    const component = await this.components.findOneOrFail(componentId);

    const [roster, scores] = await Promise.all([
      this.enrollmentModel
        .find({
          classroomId: new Types.ObjectId(classroomId),
          status: 'active',
          deletedAt: null,
        })
        .sort({ rollNumber: 1 })
        .lean()
        .exec(),
      this.model
        .find({
          componentId: new Types.ObjectId(componentId),
          classroomId: new Types.ObjectId(classroomId),
          deletedAt: null,
        })
        .lean()
        .exec(),
    ]);

    const byStudent = new Map(scores.map((s) => [s.studentId.toString(), s]));

    return {
      component: {
        id: component._id.toString(),
        nameLo: component.nameLo,
        maxScore: component.maxScore,
        weight: component.weight,
        isLocked: component.isLocked,
      },
      entries: roster.map((enrollment) => {
        const score = byStudent.get(enrollment.studentId.toString());
        return {
          studentId: enrollment.studentId.toString(),
          studentCode: enrollment.studentCode,
          studentNameLo: enrollment.studentNameLo,
          rollNumber: enrollment.rollNumber,
          score: score?.score ?? null,
          isAbsent: score?.isAbsent ?? false,
          isLocked: score?.isLocked ?? false,
          remark: score?.remark ?? null,
        };
      }),
    };
  }

  /**
   * Saves a batch of marks for one component.
   *
   * Enforces, in order:
   *  1. the semester is not closed;
   *  2. the caller actually teaches this subject to this class (unless they hold
   *     a blanket `scores:manage` grant);
   *  3. the score does not exceed the component maximum;
   *  4. the student is genuinely enrolled in the classroom;
   *  5. locked scores are only amended with an explicit reason, and every such
   *     amendment is audited individually.
   */
  async batchSave(
    dto: BatchSaveScoresDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<BatchSaveResultDto> {
    const component = await this.components.findOneOrFail(dto.componentId);
    await this.semesters.getWritableOrFail(component.semesterId.toString());

    await this.assertCanGrade(component, dto.classroomId, actor);

    // A locked component is a deliberate "grades submitted" state; reopening it
    // needs a stated reason that lands in the audit trail.
    if (component.isLocked && !dto.overrideReason) {
      throw AppException.conflict('score.overrideReasonRequired', {
        componentId: component._id.toString(),
      });
    }

    const roster = await this.enrollmentModel
      .find({
        classroomId: new Types.ObjectId(dto.classroomId),
        status: 'active',
        deletedAt: null,
      })
      .select('studentId schoolYearId')
      .lean()
      .exec();
    const enrolled = new Map(roster.map((e) => [e.studentId.toString(), e]));

    const result: BatchSaveResultDto = { saved: 0, skipped: 0, errors: [] };
    const touched: string[] = [];

    for (const entry of dto.entries) {
      try {
        const enrollment = enrolled.get(entry.studentId);
        if (!enrollment) throw AppException.badRequest('score.studentNotInClassroom');

        if (entry.score !== null && entry.score !== undefined && entry.score > component.maxScore) {
          throw AppException.badRequest('score.exceedsMax', {
            score: entry.score,
            maxScore: component.maxScore,
          });
        }

        await this.tx.run((session) =>
          this.saveOne(
            entry,
            component,
            dto.classroomId,
            enrollment.schoolYearId,
            actor,
            ip,
            dto.overrideReason,
            session,
          ),
        );
        result.saved += 1;
        touched.push(entry.studentId);
      } catch (error) {
        result.skipped += 1;
        result.errors.push({
          studentId: entry.studentId,
          reason:
            error instanceof AppException
              ? error.messageKey
              : error instanceof Error
                ? error.message
                : 'unknown error',
        });
      }
    }

    // Whatever was computed from these marks is now out of date and says so
    // until the office recomputes the class.
    if (touched.length > 0) {
      await this.staleness.markStale(
        {
          studentIds: touched,
          classroomId: dto.classroomId,
          semesterId: component.semesterId,
        },
        `scores saved for component ${component.nameLo}`,
      );
    }

    return result;
  }

  /**
   * Locks every score for a component in a classroom.
   *
   * Locks the component too, so scores that have not been entered yet cannot be
   * added afterwards — otherwise "locked" would only apply to marks that
   * happened to exist at the time.
   */
  async lock(
    dto: LockScoresDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ locked: number }> {
    const component = await this.components.findOneOrFail(dto.componentId);
    await this.assertCanGrade(component, dto.classroomId, actor);

    return this.tx.run(async (session) => {
      const now = new Date();
      const lockedBy = new Types.ObjectId(actor.sub);

      const outcome = await this.model
        .updateMany(
          {
            componentId: component._id,
            classroomId: new Types.ObjectId(dto.classroomId),
            isLocked: false,
            deletedAt: null,
          },
          { $set: { isLocked: true, lockedAt: now, lockedBy } },
          { session },
        )
        .exec();

      await this.components.setLockState(
        component._id.toString(),
        { isLocked: true, lockedAt: now, lockedBy },
        { actor, ip, session },
      );

      await this.audit.record(
        {
          action: 'lock',
          entityType: 'scores',
          entityId: component._id,
          userId: actor.sub,
          username: actor.username,
          newValue: { componentId: dto.componentId, classroomId: dto.classroomId },
          ip,
          reason: `locked ${outcome.modifiedCount} scores`,
        },
        session,
      );

      return { locked: outcome.modifiedCount };
    });
  }

  /** Lifts a lock. Requires `scores:manage` and a reason, both audited. */
  async unlock(
    dto: UnlockScoresDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ unlocked: number }> {
    const component = await this.components.findOneOrFail(dto.componentId);

    return this.tx.run(async (session) => {
      const outcome = await this.model
        .updateMany(
          {
            componentId: component._id,
            classroomId: new Types.ObjectId(dto.classroomId),
            isLocked: true,
            deletedAt: null,
          },
          { $set: { isLocked: false, lockedAt: null, lockedBy: null } },
          { session },
        )
        .exec();

      await this.components.setLockState(
        component._id.toString(),
        { isLocked: false, lockedAt: null, lockedBy: null },
        { actor, ip, session },
      );

      await this.audit.record(
        {
          action: 'unlock',
          entityType: 'scores',
          entityId: component._id,
          userId: actor.sub,
          username: actor.username,
          newValue: { componentId: dto.componentId, classroomId: dto.classroomId },
          ip,
          reason: dto.reason,
        },
        session,
      );

      return { unlocked: outcome.modifiedCount };
    });
  }

  /** Every score a student earned in a semester, grouped for the report card. */
  async findStudentScores(studentId: string, semesterId: string, actor: AuthenticatedUser) {
    await this.scope.assertCanAccessStudent(actor, studentId);

    return this.model
      .find({
        studentId: new Types.ObjectId(studentId),
        semesterId: new Types.ObjectId(semesterId),
        deletedAt: null,
      })
      .populate('componentId', 'nameLo type weight maxScore displayOrder')
      .populate('subjectId', 'code nameLo credits')
      .exec();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async saveOne(
    entry: BatchSaveScoresDto['entries'][number],
    component: ScoreComponentDocument,
    classroomId: string,
    schoolYearId: Types.ObjectId,
    actor: AuthenticatedUser,
    ip: string | null,
    overrideReason: string | undefined,
    session: ClientSession,
  ): Promise<void> {
    const existing = await this.model
      .findOne({
        studentId: new Types.ObjectId(entry.studentId),
        componentId: component._id,
        deletedAt: null,
      })
      .session(session)
      .exec();

    if (existing?.isLocked && !overrideReason) {
      throw AppException.conflict('score.overrideReasonRequired');
    }

    const nextValues = {
      score: entry.isAbsent ? null : (entry.score ?? null),
      isAbsent: entry.isAbsent ?? false,
      remark: entry.remark ?? null,
    };

    if (!existing) {
      await this.model.create(
        [
          {
            studentId: new Types.ObjectId(entry.studentId),
            componentId: component._id,
            subjectId: component.subjectId,
            semesterId: component.semesterId,
            schoolYearId,
            classroomId: new Types.ObjectId(classroomId),
            maxScore: component.maxScore,
            recordedBy: new Types.ObjectId(actor.sub),
            ...nextValues,
          },
        ],
        { session },
      );

      await this.audit.record(
        {
          action: 'create',
          entityType: 'scores',
          userId: actor.sub,
          username: actor.username,
          newValue: {
            studentId: entry.studentId,
            componentId: component._id.toString(),
            ...nextValues,
          },
          ip,
        },
        session,
      );
      return;
    }

    const changed =
      existing.score !== nextValues.score ||
      existing.isAbsent !== nextValues.isAbsent ||
      existing.remark !== nextValues.remark;

    if (!changed) return;

    const before = { score: existing.score, isAbsent: existing.isAbsent, remark: existing.remark };
    const wasLocked = existing.isLocked;

    await this.model
      .updateOne(
        { _id: existing._id },
        {
          $set: { ...nextValues, recordedBy: new Types.ObjectId(actor.sub) },
          // Only post-lock amendments count as revisions — that is the number
          // an auditor cares about.
          ...(wasLocked ? { $inc: { revisionCount: 1 } } : {}),
        },
        { session },
      )
      .exec();

    await this.audit.record(
      {
        action: 'update',
        entityType: 'scores',
        entityId: existing._id,
        userId: actor.sub,
        username: actor.username,
        oldValue: before,
        newValue: nextValues,
        ip,
        reason: wasLocked ? `POST-LOCK AMENDMENT: ${overrideReason}` : null,
      },
      session,
    );
  }

  /**
   * Only the assigned teacher may grade a class.
   *
   * A holder of `scores:manage` (admin, academic office) bypasses the check —
   * they need to be able to correct marks for a teacher who has left.
   */
  private async assertCanGrade(
    component: ScoreComponentDocument,
    classroomId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const canManageAll = actor.permissions.some(
      (p) => p.resource === 'scores' && p.actions.includes('manage'),
    );
    if (canManageAll) return;

    if (actor.personType !== 'teacher' || !actor.personId) {
      throw AppException.forbidden('score.notAssignedTeacher');
    }

    const isAssigned = await this.assignments.isAssignedTeacher(
      actor.personId,
      component.subjectId,
      new Types.ObjectId(classroomId),
      component.semesterId,
    );
    if (!isAssigned) {
      throw AppException.forbidden('score.notAssignedTeacher', {
        subjectId: component.subjectId.toString(),
        classroomId,
      });
    }
  }
}
