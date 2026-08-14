import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import {
  Subject,
  SubjectDocument,
  SubjectGroup,
  SubjectGroupDocument,
  Teacher,
  TeacherDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { escapeRegex } from '../users/users.service';
import {
  CreateSubjectGroupDto,
  QuerySubjectGroupsDto,
  UpdateSubjectGroupDto,
} from './dto/subject-group.dto';

/**
 * Enough of the head to render a name in either language.
 *
 * The client tells a populated head from a bare id by its shape, so the list and
 * the single-document read must both populate: an id alone reads as a vacant
 * post, and the edit form would then drop the head on the next save.
 */
const HEAD_TEACHER_FIELDS = 'teacherCode firstNameLo lastNameLo firstNameEn lastNameEn';

@Injectable()
export class SubjectGroupsService extends BaseCrudService<SubjectGroupDocument> {
  protected readonly entityType = 'subjectGroups';
  protected readonly sortableFields = ['sortOrder', 'code', 'nameLo', 'createdAt'] as const;
  protected readonly defaultSort = { sortOrder: 1 as const };

  constructor(
    @InjectModel(SubjectGroup.name) model: Model<SubjectGroupDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    audit: AuditLogsService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QuerySubjectGroupsDto) {
    const filter: Record<string, unknown> = {};
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

  async findAll(query: QuerySubjectGroupsDto) {
    // Not `findAllPaginated`: the base read cannot populate, and the head is the
    // one column on this page a person actually looks at.
    const filter = { deletedAt: null, ...this.buildFilter(query) };
    const sort = query.toSort(this.sortableFields, this.defaultSort);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('headTeacherId', HEAD_TEACHER_FIELDS)
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const group = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('headTeacherId', HEAD_TEACHER_FIELDS)
      .exec();
    if (!group) throw AppException.notFound();
    return group;
  }

  /** Every active group, in display order — the axis the compliance matrix groups by. */
  async findAllActive(session?: ClientSession): Promise<SubjectGroupDocument[]> {
    return this.model
      .find({ isActive: true, deletedAt: null })
      .sort({ sortOrder: 1 })
      .session(session ?? null)
      .exec();
  }

  async create(dto: CreateSubjectGroupDto, context: CrudContext) {
    await this.assertHeadIsTeacher(dto.headTeacherId);
    const created = await this.createDocument(
      {
        ...dto,
        headTeacherId: dto.headTeacherId ? new Types.ObjectId(dto.headTeacherId) : null,
      } as Partial<SubjectGroupDocument>,
      context,
    );
    // Re-read so a write answers in the same shape as a read — the client keeps
    // the returned row, and a bare id there would show the group as headless.
    return this.findOne(String(created._id));
  }

  async update(id: string, dto: UpdateSubjectGroupDto, context: CrudContext) {
    // `code` is deliberately absent from the update DTO: subjects and teachers
    // are filed under this group by id, but the code is what a person reads on
    // an exported report, and renaming it mid-year makes two years' reports
    // disagree about the same department.
    if (dto.headTeacherId) await this.assertHeadIsTeacher(dto.headTeacherId);

    const patch: Record<string, unknown> = { ...dto };
    if (dto.headTeacherId !== undefined) {
      patch.headTeacherId = dto.headTeacherId ? new Types.ObjectId(dto.headTeacherId) : null;
    }
    await this.updateDocument(id, patch, context);
    return this.findOne(id);
  }

  async remove(id: string, context: CrudContext) {
    // Subjects and teachers point here by id, so removing a group in use would
    // leave rows grouped under a department that no longer resolves.
    await this.assertNotReferenced([
      { model: this.subjectModel as unknown as Model<unknown>, field: 'subjectGroupId', id },
      { model: this.teacherModel as unknown as Model<unknown>, field: 'subjectGroupId', id },
    ]);
    return this.softDelete(id, context);
  }

  /**
   * The head is a `Teacher`, not a `User`: the notification layer resolves an
   * account from the person, and a group may be headed by someone who has not
   * been given a login yet.
   */
  private async assertHeadIsTeacher(headTeacherId?: string | null): Promise<void> {
    if (!headTeacherId) return;
    const exists = await this.teacherModel
      .exists({ _id: headTeacherId, deletedAt: null })
      .lean()
      .exec();
    if (!exists) throw AppException.notFound('common.notFound', { field: 'headTeacherId' });
  }
}
