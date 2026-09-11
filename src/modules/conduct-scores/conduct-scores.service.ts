import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { ConductGrade } from 'src/common/constants/enums';
import { ConductScore, ConductScoreDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { SemestersService } from '../semesters/semesters.service';
import { conductGradeFor } from '../term-results/grading';
import { TermResultStalenessService } from '../term-results/term-result-staleness.service';
import { QueryConductScoresDto, UpsertConductScoreDto } from './dto/conduct-score.dto';

@Injectable()
export class ConductScoresService {
  constructor(
    @InjectModel(ConductScore.name) private readonly model: Model<ConductScoreDocument>,
    private readonly semesters: SemestersService,
    private readonly classrooms: ClassroomsService,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
    private readonly staleness: TermResultStalenessService,
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
      // Typed in by a person, so it outranks anything the deduction ledger
      // would compute — see `applyFromDeductions`.
      source: 'manual' as const,
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

      await this.flagTermResult(values.studentId, values.semesterId, 'conduct score updated');
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

    await this.flagTermResult(values.studentId, values.semesterId, 'conduct score recorded');
    return created;
  }

  /**
   * The conduct grade is printed on the report card, so a change to it dates the
   * stored term result exactly as a mark does.
   */
  private async flagTermResult(
    studentId: Types.ObjectId,
    semesterId: Types.ObjectId,
    reason: string,
  ): Promise<void> {
    await this.staleness.markStale({ studentIds: [studentId], semesterId }, reason);
  }

  /**
   * Publishes one term's conduct score from the deduction ledger.
   *
   * The school's rule sheet makes the mark a consequence rather than a
   * judgement: 100 at the start of the school year, less what the published
   * rules have cost. So the ledger writes the mark, and the report card needs no
   * second act of data entry to agree with the discipline record.
   *
   * The 100 is a year's budget, so `score` is the balance as it stood at the end
   * of the term being written — the caller works that out, because only it knows
   * the year's rows. Each term of the year holds its own row, and ພາກຮຽນ II's
   * carries what ພາກຮຽນ I already spent.
   *
   * It will not touch a row someone entered by hand. A mark the office set is a
   * decision — a child forgiven their deductions, or marked down for something
   * the sheet has no number for — and having the next 5-point deduction quietly
   * reverse it would make the office's own screen untrustworthy. Returns whether
   * it wrote, so the caller can say so.
   */
  async applyFromDeductions(input: {
    studentId: Types.ObjectId;
    semesterId: Types.ObjectId;
    schoolYearId: Types.ObjectId;
    classroomId: Types.ObjectId;
    score: number;
    actor: AuthenticatedUser;
    ip: string | null;
  }): Promise<{ written: boolean; score: number; grade: ConductGrade }> {
    const grade = conductGradeFor(input.score);
    const existing = await this.model
      .findOne({
        studentId: input.studentId,
        semesterId: input.semesterId,
        periodType: 'semester',
        periodValue: 1,
        deletedAt: null,
      })
      .exec();

    if (existing && existing.source === 'manual') {
      return { written: false, score: existing.score, grade: existing.grade };
    }

    // Nothing has changed, so neither the audit trail nor the term result needs
    // to hear about it — a class of thirty is re-published on every deduction.
    if (existing && existing.score === input.score) {
      return { written: false, score: existing.score, grade: existing.grade };
    }

    const values = {
      studentId: input.studentId,
      semesterId: input.semesterId,
      schoolYearId: input.schoolYearId,
      classroomId: input.classroomId,
      periodType: 'semester' as const,
      // One conduct row per term, so there is only ever a first of them; the
      // year's account is spread across those rows, not stored again here.
      periodValue: 1,
      score: input.score,
      grade,
      source: 'deductions' as const,
      recordedBy: new Types.ObjectId(input.actor.sub),
    };

    const written = await this.model
      .findOneAndUpdate(
        {
          studentId: input.studentId,
          semesterId: input.semesterId,
          periodType: 'semester',
          periodValue: 1,
          deletedAt: null,
        },
        { $set: values },
        { new: true, upsert: true },
      )
      .exec();

    await this.audit.record({
      action: existing ? 'update' : 'create',
      entityType: 'conductScores',
      entityId: written._id,
      userId: input.actor.sub,
      username: input.actor.username,
      oldValue: existing ? { score: existing.score, grade: existing.grade } : undefined,
      newValue: { score: values.score, grade: values.grade, source: values.source },
      ip: input.ip,
    });

    await this.flagTermResult(input.studentId, input.semesterId, 'conduct deduction recorded');
    return { written: true, score: values.score, grade };
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
