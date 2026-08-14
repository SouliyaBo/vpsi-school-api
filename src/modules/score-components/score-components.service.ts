import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Score, ScoreComponent, ScoreComponentDocument, ScoreDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SemestersService } from '../semesters/semesters.service';
import { SubjectsService } from '../subjects/subjects.service';
import { round2 } from '../term-results/grading';
import {
  CreateScoreComponentDto,
  QueryScoreComponentsDto,
  UpdateScoreComponentDto,
  WeightSummaryDto,
} from './dto/score-component.dto';

/** Weights are compared with a tolerance so 33.33 × 3 still counts as 100. */
const WEIGHT_TOLERANCE = 0.01;
const REQUIRED_TOTAL_WEIGHT = 100;

@Injectable()
export class ScoreComponentsService extends BaseCrudService<ScoreComponentDocument> {
  protected readonly entityType = 'scoreComponents';
  protected readonly sortableFields = ['displayOrder', 'nameLo', 'weight', 'dueDate'] as const;
  protected readonly defaultSort = { displayOrder: 1 as const };

  constructor(
    @InjectModel(ScoreComponent.name) model: Model<ScoreComponentDocument>,
    @InjectModel(Score.name) private readonly scoreModel: Model<ScoreDocument>,
    audit: AuditLogsService,
    private readonly subjects: SubjectsService,
    private readonly semesters: SemestersService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QueryScoreComponentsDto) {
    const filter: Record<string, unknown> = {};
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    return filter;
  }

  findAll(query: QueryScoreComponentsDto): Promise<PaginatedResponse<ScoreComponentDocument>> {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /**
   * The components that apply to a subject in a classroom.
   *
   * Includes both class-specific components and the subject-wide ones
   * (`classroomId: null`), because a class is graded on the union of the two.
   */
  async findForSubjectAndClassroom(
    subjectId: Types.ObjectId | string,
    semesterId: Types.ObjectId | string,
    classroomId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<ScoreComponentDocument[]> {
    // Cast explicitly: callers pass ids as strings, and an uncast string inside
    // `$or` does not match a stored ObjectId.
    const query = this.model
      .find({
        subjectId: new Types.ObjectId(subjectId),
        semesterId: new Types.ObjectId(semesterId),
        $or: [{ classroomId: new Types.ObjectId(classroomId) }, { classroomId: null }],
        deletedAt: null,
      })
      .sort({ displayOrder: 1 });

    if (session) query.session(session);
    return query.exec();
  }

  /**
   * Reports whether the weights for a subject sum to 100.
   *
   * Exposed as an endpoint rather than enforced on every write: a teacher builds
   * components up one at a time, and rejecting the first one for summing to 20
   * would make the feature unusable. The total is enforced at the point it
   * matters — when the term result is computed.
   */
  async getWeightSummary(
    subjectId: string,
    semesterId: string,
    classroomId?: string,
  ): Promise<WeightSummaryDto> {
    const filter: FilterQuery<ScoreComponentDocument> = {
      subjectId: new Types.ObjectId(subjectId),
      semesterId: new Types.ObjectId(semesterId),
      deletedAt: null,
    };
    if (classroomId) {
      filter.$or = [{ classroomId: new Types.ObjectId(classroomId) }, { classroomId: null }];
    }

    const components = await this.model.find(filter).select('weight').lean().exec();
    const totalWeight = round2(components.reduce((sum, c) => sum + c.weight, 0));

    return {
      totalWeight,
      isValid: Math.abs(totalWeight - REQUIRED_TOTAL_WEIGHT) <= WEIGHT_TOLERANCE,
      componentCount: components.length,
    };
  }

  /** Throws unless the weights total 100 — called before computing term results. */
  async assertWeightsValid(
    subjectId: Types.ObjectId | string,
    semesterId: Types.ObjectId | string,
    classroomId: Types.ObjectId | string,
  ): Promise<void> {
    const summary = await this.getWeightSummary(
      subjectId.toString(),
      semesterId.toString(),
      classroomId.toString(),
    );
    if (!summary.isValid) {
      throw AppException.unprocessable('score.weightSumInvalid', {
        subjectId: subjectId.toString(),
        totalWeight: summary.totalWeight,
        expected: REQUIRED_TOTAL_WEIGHT,
      });
    }
  }

  async create(dto: CreateScoreComponentDto, context: CrudContext) {
    await Promise.all([
      this.subjects.assertExists(dto.subjectId),
      this.semesters.getWritableOrFail(dto.semesterId),
    ]);

    // Refuse to overshoot 100 rather than let it be discovered later at
    // computation time.
    const summary = await this.getWeightSummary(dto.subjectId, dto.semesterId, dto.classroomId);
    if (summary.totalWeight + dto.weight > REQUIRED_TOTAL_WEIGHT + WEIGHT_TOLERANCE) {
      throw AppException.unprocessable('score.weightSumInvalid', {
        currentTotal: summary.totalWeight,
        requested: dto.weight,
        wouldTotal: round2(summary.totalWeight + dto.weight),
      });
    }

    return this.createDocument(
      {
        ...dto,
        subjectId: new Types.ObjectId(dto.subjectId),
        semesterId: new Types.ObjectId(dto.semesterId),
        classroomId: dto.classroomId ? new Types.ObjectId(dto.classroomId) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      } as Partial<ScoreComponentDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateScoreComponentDto, context: CrudContext) {
    const component = await this.findOneOrFail(id);

    if (component.isLocked) {
      throw AppException.conflict('score.locked', {
        reason: 'unlock the component before editing it',
      });
    }

    if (dto.maxScore !== undefined && dto.maxScore !== component.maxScore) {
      // Scores store their own `maxScore` copy; changing the component's would
      // desynchronise recorded marks from the scale they were given on.
      const hasScores = await this.scoreModel
        .exists({ componentId: component._id, deletedAt: null })
        .exec();
      if (hasScores) {
        throw AppException.conflict('common.inUse', {
          reason: 'maxScore cannot be changed once scores have been recorded',
        });
      }
    }

    if (dto.weight !== undefined) {
      const summary = await this.getWeightSummary(
        component.subjectId.toString(),
        component.semesterId.toString(),
        component.classroomId?.toString(),
      );
      const wouldTotal = round2(summary.totalWeight - component.weight + dto.weight);
      if (wouldTotal > REQUIRED_TOTAL_WEIGHT + WEIGHT_TOLERANCE) {
        throw AppException.unprocessable('score.weightSumInvalid', { wouldTotal });
      }
    }

    return this.updateDocument(
      id,
      { ...dto, ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}) },
      context,
    );
  }

  /**
   * Sets the component's lock state.
   *
   * Called by ScoresService, which owns the lock workflow — locking the
   * component alongside its scores is what stops new marks being added to a
   * component whose grades have already been submitted.
   */
  async setLockState(
    id: string,
    state: { isLocked: boolean; lockedAt: Date | null; lockedBy: Types.ObjectId | null },
    context: CrudContext,
  ): Promise<ScoreComponentDocument> {
    return this.updateDocument(id, state, context);
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    const hasScores = await this.scoreModel.exists({ componentId: id, deletedAt: null }).exec();
    if (hasScores) {
      throw AppException.conflict('common.inUse', {
        reason: 'component has recorded scores; delete them first',
      });
    }
    await this.softDelete(id, context);
  }
}
