import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { ConductScore, ConductScoreDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { SemestersService } from '../semesters/semesters.service';
import { conductGradeFor } from '../term-results/grading';
import { QueryConductScoresDto, UpsertConductScoreDto } from './dto/conduct-score.dto';

@Injectable()
export class ConductScoresService {
  constructor(
    @InjectModel(ConductScore.name) private readonly model: Model<ConductScoreDocument>,
    private readonly semesters: SemestersService,
    private readonly classrooms: ClassroomsService,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
  ) {}

  async findAll(
    query: QueryConductScoresDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ConductScoreDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.periodType) filter.periodType = query.periodType;

    await this.scope.applyStudentScope(filter, actor);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ periodType: 1, periodValue: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * Creates or replaces a conduct score for one period.
   *
   * Upsert rather than create: a homeroom teacher revisiting a month's conduct
   * mark is editing an assessment, not adding a second one — and the unique
   * index on (student, semester, periodType, periodValue) enforces that.
   *
   * The letter grade is derived from the numeric score rather than accepted from
   * the client, so the two can never disagree.
   */
  async upsert(
    dto: UpsertConductScoreDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<ConductScoreDocument> {
    const semester = await this.semesters.getWritableOrFail(dto.semesterId);
    const classroom = await this.classrooms.findOneOrFail(dto.classroomId);

    if (dto.periodType === 'monthly' && (dto.periodValue < 1 || dto.periodValue > 12)) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'periodValue',
        reason: 'monthly conduct scores use a month number 1–12',
      });
    }

    const existing = await this.model
      .findOne({
        studentId: new Types.ObjectId(dto.studentId),
        semesterId: new Types.ObjectId(dto.semesterId),
        periodType: dto.periodType,
        periodValue: dto.periodValue,
        deletedAt: null,
      })
      .exec();

    const values = {
      studentId: new Types.ObjectId(dto.studentId),
      semesterId: new Types.ObjectId(dto.semesterId),
      schoolYearId: semester.schoolYearId,
      classroomId: classroom._id,
      periodType: dto.periodType,
      periodValue: dto.periodValue,
      score: dto.score,
      grade: conductGradeFor(dto.score),
      remark: dto.remark ?? null,
      recordedBy: new Types.ObjectId(actor.sub),
    };

    if (existing) {
      const updated = await this.model
        .findOneAndUpdate({ _id: existing._id }, { $set: values }, { new: true })
        .exec();

      await this.audit.record({
        action: 'update',
        entityType: 'conductScores',
        entityId: existing._id,
        userId: actor.sub,
        username: actor.username,
        oldValue: { score: existing.score, grade: existing.grade },
        newValue: { score: values.score, grade: values.grade },
        ip,
      });

      return updated!;
    }

    const created = await this.model.create(values);
    await this.audit.record({
      action: 'create',
      entityType: 'conductScores',
      entityId: created._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { score: values.score, grade: values.grade },
      ip,
    });

    return created;
  }

  /**
   * The conduct grade to print on a term result.
   *
   * Prefers an explicit `semester` assessment; falls back to the mean of the
   * monthly scores, because many schools only record monthly conduct.
   */
  async resolveSemesterGrade(
    studentId: Types.ObjectId,
    semesterId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ConductScoreDocument['grade'] | null> {
    const scores = await this.model
      .find({ studentId, semesterId, deletedAt: null })
      .session(session ?? null)
      .lean()
      .exec();

    if (scores.length === 0) return null;

    const semesterScore = scores.find((s) => s.periodType === 'semester');
    if (semesterScore) return semesterScore.grade;

    const monthly = scores.filter((s) => s.periodType === 'monthly');
    if (monthly.length === 0) return null;

    const mean = monthly.reduce((sum, s) => sum + s.score, 0) / monthly.length;
    return conductGradeFor(mean);
  }

  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const doc = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!doc) throw AppException.notFound();

    doc.deletedAt = new Date();
    doc.deletedBy = new Types.ObjectId(actor.sub);
    await doc.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'conductScores',
      entityId: doc._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { score: doc.score, grade: doc.grade },
      ip,
    });
  }
}
