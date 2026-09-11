import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Classroom, ClassroomDocument, Enrollment, EnrollmentDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GradeLevelsService } from '../grade-levels/grade-levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { TeachersService } from '../teachers/teachers.service';
import { escapeRegex } from '../users/users.service';
import { CreateClassroomDto, QueryClassroomsDto, UpdateClassroomDto } from './dto/classroom.dto';

@Injectable()
export class ClassroomsService extends BaseCrudService<ClassroomDocument> {
  protected readonly entityType = 'classrooms';
  protected readonly sortableFields = ['name', 'currentCount', 'createdAt'] as const;
  protected readonly defaultSort = { name: 1 as const };

  constructor(
    @InjectModel(Classroom.name) model: Model<ClassroomDocument>,
    // Roll numbers are issued off the register itself — see `nextRollNumber`.
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    audit: AuditLogsService,
    private readonly schoolYears: SchoolYearsService,
    private readonly gradeLevels: GradeLevelsService,
    private readonly teachers: TeachersService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QueryClassroomsDto) {
    const filter: Record<string, unknown> = {};
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.gradeLevelId) filter.gradeLevelId = new Types.ObjectId(query.gradeLevelId);
    if (query.homeroomTeacherId) {
      filter.homeroomTeacherId = new Types.ObjectId(query.homeroomTeacherId);
    }
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { room: { $regex: escaped, $options: 'i' } },
      ];
    }
    return filter;
  }

  /**
   * The list is rendered as `<grade code> <section>` with the homeroom teacher
   * beside it, so the refs are resolved here rather than left as bare ids —
   * otherwise every row would need a separate lookup to be readable.
   */
  async findAll(query: QueryClassroomsDto) {
    const filter = { deletedAt: null, ...this.buildFilter(query) };
    const sort = query.toSort(this.sortableFields, this.defaultSort);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('gradeLevelId', 'code nameLo nameEn level')
        .populate('homeroomTeacherId', 'teacherCode firstNameLo lastNameLo firstNameEn lastNameEn')
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async findOnePopulated(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const doc = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('gradeLevelId', 'code nameLo nameEn level')
      .populate('homeroomTeacherId', 'teacherCode firstNameLo lastNameLo')
      .populate('schoolYearId', 'code nameLo')
      .exec();
    if (!doc) throw AppException.notFound();
    return doc;
  }

  async create(dto: CreateClassroomDto, context: CrudContext) {
    await Promise.all([
      this.schoolYears.assertExists(dto.schoolYearId),
      this.gradeLevels.assertExists(dto.gradeLevelId),
      dto.homeroomTeacherId ? this.teachers.assertExists(dto.homeroomTeacherId) : Promise.resolve(),
    ]);

    return this.createDocument(
      {
        ...dto,
        schoolYearId: new Types.ObjectId(dto.schoolYearId),
        gradeLevelId: new Types.ObjectId(dto.gradeLevelId),
        homeroomTeacherId: dto.homeroomTeacherId ? new Types.ObjectId(dto.homeroomTeacherId) : null,
      } as Partial<ClassroomDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateClassroomDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);

    if (dto.homeroomTeacherId) {
      await this.teachers.assertExists(dto.homeroomTeacherId);
    }
    // Shrinking capacity below the students already placed would leave the
    // classroom permanently over its limit with no way to reconcile.
    if (dto.capacity !== undefined && dto.capacity < current.currentCount) {
      throw AppException.badRequest('classroom.capacityExceeded', {
        currentCount: current.currentCount,
        requestedCapacity: dto.capacity,
      });
    }

    return this.updateDocument(id, dto, context);
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    const classroom = await this.findOneOrFail(id);
    if (classroom.currentCount > 0) {
      throw AppException.conflict('common.inUse', {
        reason: 'classroom still has enrolled students',
        currentCount: classroom.currentCount,
      });
    }
    await this.softDelete(id, context);
  }

  /**
   * Adjusts the cached roster size.
   *
   * Always called inside the enrollment transaction so `currentCount` cannot
   * drift from the actual number of enrollment rows.
   */
  async adjustCount(
    classroomId: Types.ObjectId | string,
    delta: number,
    session: ClientSession,
  ): Promise<void> {
    await this.model
      .updateOne({ _id: classroomId }, { $inc: { currentCount: delta } }, { session })
      .exec();
  }

  /** Loads a classroom and refuses if adding one more student would overfill it. */
  async assertHasSpace(classroomId: string, session: ClientSession): Promise<ClassroomDocument> {
    const classroom = await this.model
      .findOne({ _id: classroomId, deletedAt: null })
      .session(session)
      .exec();
    if (!classroom) throw AppException.notFound();
    if (classroom.currentCount >= classroom.capacity) {
      throw AppException.conflict('classroom.capacityExceeded', {
        capacity: classroom.capacity,
        currentCount: classroom.currentCount,
      });
    }
    return classroom;
  }

  /**
   * Next free roll number in a classroom — one past the highest already issued.
   *
   * Read off the register rather than off `currentCount`, which is a count of
   * who is in the room and not a record of what has been handed out. The two
   * part company the moment anybody leaves: a class of 25 whose roll 7 is
   * removed counts 24, and the next child enrolled was handed 25 — a number
   * already worn by the student at the foot of the list. That is how ມ.5 came to
   * have two roll 10s and no roll 26, and four other classes the same.
   *
   * Closed placements are counted too. A transferred or deleted row still names
   * the number that was issued, and reissuing it would collide with the marks
   * and sheets already filed under it.
   */
  async nextRollNumber(classroomId: Types.ObjectId, session: ClientSession): Promise<number> {
    const [highest] = await this.enrollmentModel
      .find({ classroomId })
      .sort({ rollNumber: -1 })
      .limit(1)
      .select('rollNumber')
      .session(session)
      .lean()
      .exec();
    return (highest?.rollNumber ?? 0) + 1;
  }
}
