import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import {
  Location,
  LocationDocument,
  SchoolYear,
  SchoolYearDocument,
  Teacher,
  TeacherDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { StorageService } from '../storage/storage.service';
import { SubjectGroupsService } from '../subject-groups/subject-groups.service';
import { escapeRegex } from '../users/users.service';
import { CreateTeacherDto, QueryTeachersDto, UpdateTeacherDto } from './dto/teacher.dto';
import { nextTeacherCode, resolveCodeYear } from './teacher-code';

/**
 * A serialized person plus a freshly signed photo URL.
 *
 * Declared explicitly because Mongoose's `toJSON()` return type is too large for
 * the compiler to name, and an inferred type here is not portable across builds.
 */
export interface WithPhotoUrl extends Record<string, unknown> {
  photoUrl: string | null;
}

@Injectable()
export class TeachersService extends BaseCrudService<TeacherDocument> {
  protected readonly entityType = 'teachers';
  protected readonly sortableFields = [
    'teacherCode',
    'lastNameLo',
    'firstNameLo',
    'hireDate',
    'createdAt',
  ] as const;
  protected readonly defaultSort = { lastNameLo: 1 as const };

  constructor(
    @InjectModel(Teacher.name) model: Model<TeacherDocument>,
    @InjectModel(Location.name) private readonly locationModel: Model<LocationDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    audit: AuditLogsService,
    private readonly storage: StorageService,
    private readonly subjectGroups: SubjectGroupsService,
  ) {
    super(model, audit);
  }

  async findAll(query: QueryTeachersDto): Promise<PaginatedResponse<TeacherDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.status) filter.status = query.status;
    if (query.villageId) filter.villageId = new Types.ObjectId(query.villageId);
    if (query.isAcademicHead !== undefined) filter.isAcademicHead = query.isAcademicHead;
    if (query.subjectGroupId) filter.subjectGroupId = new Types.ObjectId(query.subjectGroupId);
    // Anchored so `ຄະນິດສາດ` does not also match a longer subject containing it.
    if (query.teachingSubject) {
      filter.teachingSubjects = {
        $regex: `^${escapeRegex(query.teachingSubject)}$`,
        $options: 'i',
      };
    }

    // Filtering by a district or province resolves to the set of villages
    // beneath it, using the locations' ancestors index.
    if (query.locationId) {
      const villageIds = await this.resolveVillageIds(query.locationId);
      filter.villageId = { $in: villageIds };
    }

    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { firstNameLo: { $regex: escaped, $options: 'i' } },
        { lastNameLo: { $regex: escaped, $options: 'i' } },
        { teacherCode: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
      ];
    }

    const sort = query.toSort(this.sortableFields, this.defaultSort);
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('villageId', 'nameLo nameEn type')
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        // Lao names sort by alphabet rather than UTF-8 code point.
        .collation({ locale: 'lo', strength: 2 })
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const teacher = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('villageId', 'nameLo nameEn type ancestors')
      .exec();
    if (!teacher) throw AppException.notFound();
    return teacher;
  }

  /** Adds a short-lived signed URL for the photo; the key itself stays internal. */
  async findOneWithPhotoUrl(id: string): Promise<WithPhotoUrl> {
    const teacher = await this.findOne(id);
    return {
      ...teacher.toJSON(),
      photoUrl: await this.storage.getSignedUrl(teacher.photoKey),
    };
  }

  async create(dto: CreateTeacherDto, context: CrudContext) {
    if (dto.villageId) await this.assertVillage(dto.villageId);
    if (dto.subjectGroupId) await this.subjectGroups.assertExists(dto.subjectGroupId);

    const teacherCode = dto.teacherCode ?? (await this.generateCode());

    return this.createDocument(
      {
        ...dto,
        teacherCode,
        villageId: dto.villageId ? new Types.ObjectId(dto.villageId) : null,
        subjectGroupId: dto.subjectGroupId ? new Types.ObjectId(dto.subjectGroupId) : null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : null,
        joinedOrgDate: dto.joinedOrgDate ? new Date(dto.joinedOrgDate) : null,
      } as Partial<TeacherDocument>,
      context,
    );
  }

  /**
   * The next code for the current school year — `T-2627-001` for 2026-2027.
   *
   * Exposed so the form can show the code it is about to give before the teacher
   * is saved. It is a preview, not a reservation: two people creating at once
   * both see the same number, and the second one's save takes the next.
   */
  async peekNextCode(): Promise<{ teacherCode: string }> {
    return { teacherCode: await this.generateCode() };
  }

  private async generateCode(): Promise<string> {
    const yearShort = await resolveCodeYear(this.schoolYearModel);
    if (!yearShort) {
      throw AppException.badRequest('common.notFound', {
        field: 'teacherCode',
        reason:
          'no school year on file to build a code from — create one (e.g. "2026-2027") ' +
          'or supply teacherCode explicitly',
      });
    }
    return nextTeacherCode(this.model, yearShort);
  }

  async update(id: string, dto: UpdateTeacherDto, context: CrudContext) {
    if (dto.villageId) await this.assertVillage(dto.villageId);
    if (dto.subjectGroupId) await this.subjectGroups.assertExists(dto.subjectGroupId);

    const patch: Record<string, unknown> = { ...dto };
    if (dto.villageId) patch.villageId = new Types.ObjectId(dto.villageId);
    if (dto.subjectGroupId !== undefined) {
      patch.subjectGroupId = dto.subjectGroupId ? new Types.ObjectId(dto.subjectGroupId) : null;
    }
    if (dto.dateOfBirth) patch.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.hireDate) patch.hireDate = new Date(dto.hireDate);
    if (dto.joinedOrgDate) patch.joinedOrgDate = new Date(dto.joinedOrgDate);

    return this.updateDocument(id, patch, context);
  }

  /** Replaces the photo and removes the previous object from storage. */
  async setPhoto(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    context: CrudContext,
  ): Promise<WithPhotoUrl> {
    const teacher = await this.findOne(id);
    const previousKey = teacher.photoKey;

    const uploaded = await this.storage.upload(file, 'photo', `teachers/${id}`);
    const updated = await this.updateDocument(id, { photoKey: uploaded.key }, context);

    // Only after the new key is committed, so a storage failure cannot leave
    // the record pointing at a deleted object.
    if (previousKey) {
      await this.storage.delete(previousKey).catch(() => undefined);
    }

    return { ...updated.toJSON(), photoUrl: await this.storage.getSignedUrl(uploaded.key) };
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }

  private async assertVillage(villageId: string): Promise<void> {
    const village = await this.locationModel
      .findOne({ _id: villageId, type: 'village', deletedAt: null })
      .exec();
    if (!village) {
      throw AppException.badRequest('common.notFound', {
        field: 'villageId',
        reason: 'must reference an existing location of type "village"',
      });
    }
  }

  /** Every village id beneath a location, for ancestry-scoped filtering. */
  private async resolveVillageIds(locationId: string): Promise<Types.ObjectId[]> {
    const villages = await this.locationModel
      .find({ ancestors: new Types.ObjectId(locationId), type: 'village', deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return villages.map((v) => v._id);
  }
}
