import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Subject, SubjectDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GradeLevelsService } from '../grade-levels/grade-levels.service';
import { SubjectGroupsService } from '../subject-groups/subject-groups.service';
import { escapeRegex } from '../users/users.service';
import { CreateSubjectDto, QuerySubjectsDto, UpdateSubjectDto } from './dto/subject.dto';

@Injectable()
export class SubjectsService extends BaseCrudService<SubjectDocument> {
  protected readonly entityType = 'subjects';
  protected readonly sortableFields = ['code', 'nameLo', 'credits', 'createdAt'] as const;
  protected readonly defaultSort = { code: 1 as const };

  constructor(
    @InjectModel(Subject.name) model: Model<SubjectDocument>,
    audit: AuditLogsService,
    private readonly gradeLevels: GradeLevelsService,
    private readonly subjectGroups: SubjectGroupsService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QuerySubjectsDto) {
    const filter: Record<string, unknown> = {};
    if (query.gradeLevelId) filter.gradeLevelId = new Types.ObjectId(query.gradeLevelId);
    if (query.subjectGroupId) filter.subjectGroupId = new Types.ObjectId(query.subjectGroupId);
    if (query.type) filter.type = query.type;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { nameLo: { $regex: escaped, $options: 'i' } },
        { nameEn: { $regex: escaped, $options: 'i' } },
        { code: { $regex: escaped, $options: 'i' } },
      ];
    }
    return filter;
  }

  /**
   * The list renders the grade level and the department by name, so both refs are
   * resolved here. Left as bare ids they read as "—" and "not yet assigned to a
   * department" on every row, however carefully the subject was filed.
   *
   * The department is matched on `deletedAt` as well: a group the school has since
   * removed is gone from the picker and routes no lesson plans, so naming it here
   * would point at a department that no longer exists anywhere else. It reads as
   * unassigned instead, which is both true and a prompt to re-file the subject.
   * The grade level is populated unconditionally — a subject belongs to its grade
   * whatever became of the row, and blanking it would lose the only thing that
   * orders this list.
   */
  async findAll(query: QuerySubjectsDto): Promise<PaginatedResponse<SubjectDocument>> {
    const filter = { deletedAt: null, ...this.buildFilter(query) };
    const sort = query.toSort(this.sortableFields, this.defaultSort);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('gradeLevelId', 'code nameLo nameEn level')
        .populate({
          path: 'subjectGroupId',
          select: 'code nameLo nameEn',
          match: { deletedAt: null },
        })
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /** Every active subject for a grade level — the basis of a class's curriculum. */
  async findByGradeLevel(
    gradeLevelId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<SubjectDocument[]> {
    return this.model
      .find({ gradeLevelId, isActive: true, deletedAt: null })
      .session(session ?? null)
      .exec();
  }

  async create(dto: CreateSubjectDto, context: CrudContext) {
    await this.gradeLevels.assertExists(dto.gradeLevelId);
    if (dto.subjectGroupId) await this.subjectGroups.assertExists(dto.subjectGroupId);
    return this.createDocument(
      {
        ...dto,
        gradeLevelId: new Types.ObjectId(dto.gradeLevelId),
        subjectGroupId: dto.subjectGroupId ? new Types.ObjectId(dto.subjectGroupId) : null,
      } as Partial<SubjectDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateSubjectDto, context: CrudContext) {
    // `gradeLevelId` is intentionally not updatable: moving a subject between
    // grades would orphan the scores already recorded against it. The department
    // *is* updatable — a school reorganises its groups without the subject
    // itself changing, and nothing is filed against `subjectGroupId`.
    if (dto.subjectGroupId) await this.subjectGroups.assertExists(dto.subjectGroupId);

    const patch: Record<string, unknown> = { ...dto };
    if (dto.subjectGroupId !== undefined) {
      patch.subjectGroupId = dto.subjectGroupId ? new Types.ObjectId(dto.subjectGroupId) : null;
    }
    return this.updateDocument(id, patch, context);
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }
}
