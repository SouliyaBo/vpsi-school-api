import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Subject, SubjectDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GradeLevelsService } from '../grade-levels/grade-levels.service';
import { SubjectGroupsService } from '../subject-groups/subject-groups.service';
import { escapeRegex } from '../users/users.service';
import { CreateSubjectDto, QuerySubjectsDto, UpdateSubjectDto } from './dto/subject.dto';
import { SubjectRole } from './subject-roles';

@Injectable()
export class SubjectsService extends BaseCrudService<SubjectDocument> {
  protected readonly entityType = 'subjects';
  protected readonly sortableFields = [
    'code',
    'nameLo',
    'credits',
    'sortOrder',
    'createdAt',
  ] as const;
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
    const filter = {
      deletedAt: null,
      ...this.buildFilter(query),
      ...(await this.roleFilter(query.role)),
    };
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
        .populate('parentSubjectId', 'code nameLo nameEn')
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

  /**
   * The subjects a mark is recorded against for a grade — `ພາສາລາວ`, `ຄະນິດສາດ`
   * and either the two composite ສາຍວິຊາ or, from ມ.4 up, the subjects they split
   * into.
   *
   * This is the divisor the school averages by: ມ.1–ມ.3 return four, ມ.4 and ມ.7
   * eight, ມ.5 and ມ.6 seven. Derived from the register rather than hard-coded so
   * a grade whose curriculum changes needs a subject row, not a release.
   */
  async findMarkedForGradeLevel(
    gradeLevelId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<SubjectDocument[]> {
    const parentIds = await this.splitParentIds(session);
    return this.model
      .find({
        gradeLevelId,
        isActive: true,
        deletedAt: null,
        ...(parentIds.length > 0 ? { _id: { $nin: parentIds } } : {}),
      })
      .sort({ sortOrder: 1, code: 1 })
      .session(session ?? null)
      .exec();
  }

  /**
   * The subject whose timetable decides who may mark this one.
   *
   * A split subject is never on the timetable — nobody is assigned to teach
   * ຟີຊິກສາດ, they are assigned to ທຳມະຊາດ — so permission and roll call resolve
   * through the parent, and everything else keys on the subject itself.
   */
  markingParentOf(subject: Pick<SubjectDocument, '_id' | 'parentSubjectId'>): Types.ObjectId {
    return subject.parentSubjectId ?? subject._id;
  }

  /** Whether other subjects are marked under this one, making it taught-only. */
  async isSplitParent(subjectId: Types.ObjectId): Promise<boolean> {
    const child = await this.model.exists({ parentSubjectId: subjectId, deletedAt: null }).exec();
    return child !== null;
  }

  /** Every subject that has children, so the two roles can be told apart in one read. */
  private async splitParentIds(session?: ClientSession): Promise<Types.ObjectId[]> {
    const ids = await this.model
      .distinct('parentSubjectId', { parentSubjectId: { $ne: null }, deletedAt: null })
      .session(session ?? null)
      .exec();
    return ids as Types.ObjectId[];
  }

  /** Narrows a listing to one of the two roles; unset returns the whole register. */
  private async roleFilter(role?: SubjectRole): Promise<Record<string, unknown>> {
    if (role === 'taught') return { parentSubjectId: null };
    if (role !== 'marked') return {};

    const parentIds = await this.splitParentIds();
    return parentIds.length > 0 ? { _id: { $nin: parentIds } } : {};
  }

  /**
   * A parent must sit in the same grade and must not itself be split.
   *
   * Both would produce a sheet nobody can read: a ມ.4 subject marked under a ມ.5
   * one, or a chain deep enough that "the subjects of this grade" stops being a
   * flat list.
   */
  private async assertParentUsable(
    parentId: string,
    gradeLevelId: string,
  ): Promise<Types.ObjectId> {
    const parent = await this.model.findOne({ _id: parentId, deletedAt: null }).exec();
    if (!parent) throw AppException.notFound();

    if (parent.gradeLevelId.toString() !== gradeLevelId) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'parentSubjectId',
        reason: 'parent subject belongs to another grade level',
      });
    }
    if (parent.parentSubjectId) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'parentSubjectId',
        reason: 'parent subject is itself marked under another subject',
      });
    }
    return parent._id;
  }

  async create(dto: CreateSubjectDto, context: CrudContext) {
    await this.gradeLevels.assertExists(dto.gradeLevelId);
    if (dto.subjectGroupId) await this.subjectGroups.assertExists(dto.subjectGroupId);
    const parentSubjectId = dto.parentSubjectId
      ? await this.assertParentUsable(dto.parentSubjectId, dto.gradeLevelId)
      : null;

    return this.createDocument(
      {
        ...dto,
        gradeLevelId: new Types.ObjectId(dto.gradeLevelId),
        subjectGroupId: dto.subjectGroupId ? new Types.ObjectId(dto.subjectGroupId) : null,
        parentSubjectId,
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
    if (dto.parentSubjectId !== undefined) {
      const current = await this.findOneOrFail(id);
      // A subject that is already a parent cannot become a child: its own
      // children would be left two levels down from the grade.
      if (dto.parentSubjectId && (await this.isSplitParent(current._id))) {
        throw AppException.conflict('common.validationFailed', {
          field: 'parentSubjectId',
          reason: 'other subjects are already marked under this one',
        });
      }
      patch.parentSubjectId = dto.parentSubjectId
        ? await this.assertParentUsable(dto.parentSubjectId, current.gradeLevelId.toString())
        : null;
    }
    return this.updateDocument(id, patch, context);
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }
}
