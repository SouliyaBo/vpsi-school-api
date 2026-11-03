import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import {
  EnrollmentDocument,
  Enrollment,
  Guardian,
  GuardianDocument,
  SchoolYear,
  SchoolYearDocument,
  Student,
  StudentDocument,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { escapeRegex } from '../users/users.service';
import { CreateGuardianDto, QueryGuardiansDto, UpdateGuardianDto } from './dto/guardian.dto';

/** One of a guardian's children, as the guardians list shows it. */
export interface GuardianChild {
  id: string;
  studentCode: string;
  firstNameLo: string;
  lastNameLo: string;
  nickname: string | null;
  status: string;
  relationship: string;
  /** This year's room, `null` when the child is not placed in one. */
  classroomId: string | null;
  classroomName: string | null;
  gradeLevelCode: string | null;
}

/** A guardian row with the children it is linked to resolved. */
export interface GuardianListRow extends Record<string, unknown> {
  children: GuardianChild[];
}

/** A write that the homeroom rule applies to, so it needs the full caller. */
export interface GuardianWriteContext extends CrudContext {
  actor?: AuthenticatedUser;
}

@Injectable()
export class GuardiansService extends BaseCrudService<GuardianDocument> {
  protected readonly entityType = 'guardians';
  protected readonly sortableFields = ['lastNameLo', 'firstNameLo', 'createdAt'] as const;
  protected readonly defaultSort = { lastNameLo: 1 as const };

  constructor(
    @InjectModel(Guardian.name) model: Model<GuardianDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    audit: AuditLogsService,
    private readonly tx: TransactionHelper,
    private readonly scope: RecordScopeService,
  ) {
    super(model, audit);
  }

  async findAll(query: QueryGuardiansDto): Promise<PaginatedResponse<GuardianListRow>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.villageId) filter.villageId = new Types.ObjectId(query.villageId);

    // The room is on the child's enrollment, so it resolves to the guardians of
    // the children sitting in it.
    if (query.classroomId) {
      const placed = await this.enrollmentModel
        .find({
          classroomId: new Types.ObjectId(query.classroomId),
          status: 'active',
          deletedAt: null,
        })
        .select('studentId')
        .lean()
        .exec();
      filter._id = {
        $in: await this.guardianIdsOf({ _id: { $in: placed.map((e) => e.studentId) } }),
      };
    }

    if (query.search) {
      const escaped = escapeRegex(query.search);
      // Staff usually know the child, not the parent: a guardian is found by
      // their own name or phone, or by the name, nickname or code of a child.
      const childMatch = await this.guardianIdsOf({
        $or: [
          { firstNameLo: { $regex: escaped, $options: 'i' } },
          { lastNameLo: { $regex: escaped, $options: 'i' } },
          { nickname: { $regex: escaped, $options: 'i' } },
          { studentCode: { $regex: escaped, $options: 'i' } },
        ],
      });
      filter.$or = [
        { firstNameLo: { $regex: escaped, $options: 'i' } },
        { lastNameLo: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { _id: { $in: childMatch } },
      ];
    }

    const sort = query.toSort(this.sortableFields, this.defaultSort);
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('villageId', 'nameLo nameEn')
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        .collation({ locale: 'lo', strength: 2 })
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(await this.withChildren(data), total, query.page, query.limit);
  }

  /** The guardians linked to any non-deleted student matching `studentFilter`. */
  private async guardianIdsOf(studentFilter: Record<string, unknown>): Promise<Types.ObjectId[]> {
    const ids = await this.studentModel
      .distinct('guardians.guardianId', { ...studentFilter, deletedAt: null })
      .exec();
    return ids as Types.ObjectId[];
  }

  /**
   * Attaches each guardian's children and the room each sits in this year.
   *
   * Two reads per page, keyed on the ids already fetched — the same shape as the
   * placements on the students list. A child with no active placement in the
   * active year (graduated, transferred, not yet placed) comes back with a null
   * room rather than last year's, which would send a caller to the wrong class.
   */
  private async withChildren(guardians: GuardianDocument[]): Promise<GuardianListRow[]> {
    if (guardians.length === 0) return [];

    const guardianIds = guardians.map((guardian) => guardian._id);
    const students = await this.studentModel
      .find({ 'guardians.guardianId': { $in: guardianIds }, deletedAt: null })
      .select('studentCode firstNameLo lastNameLo nickname status guardians')
      .sort({ studentCode: 1 })
      .lean()
      .exec();

    const activeYear = await this.schoolYearModel
      .findOne({ isActive: true, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    const enrollments =
      activeYear && students.length > 0
        ? await this.enrollmentModel
            .find({
              studentId: { $in: students.map((student) => student._id) },
              schoolYearId: activeYear._id,
              status: 'active',
              deletedAt: null,
            })
            .populate('classroomId', 'name')
            .populate('gradeLevelId', 'code')
            .lean()
            .exec()
        : [];

    const placementOf = new Map(
      enrollments.map((enrollment) => {
        const classroom = enrollment.classroomId as unknown as {
          _id: Types.ObjectId;
          name?: string;
        };
        const gradeLevel = enrollment.gradeLevelId as unknown as { code?: string } | null;
        return [
          String(enrollment.studentId),
          {
            classroomId: String(classroom?._id ?? enrollment.classroomId),
            classroomName: classroom?.name ?? null,
            gradeLevelCode: gradeLevel?.code ?? null,
          },
        ] as const;
      }),
    );

    const childrenOf = new Map<string, GuardianChild[]>();
    for (const student of students) {
      const placement = placementOf.get(String(student._id));
      for (const link of student.guardians) {
        const key = String(link.guardianId);
        const children = childrenOf.get(key) ?? [];
        children.push({
          id: String(student._id),
          studentCode: student.studentCode,
          firstNameLo: student.firstNameLo,
          lastNameLo: student.lastNameLo,
          nickname: student.nickname ?? null,
          status: student.status,
          relationship: link.relationship,
          classroomId: placement?.classroomId ?? null,
          classroomName: placement?.classroomName ?? null,
          gradeLevelCode: placement?.gradeLevelCode ?? null,
        });
        childrenOf.set(key, children);
      }
    }

    return guardians.map((guardian) => ({
      ...(guardian.toJSON() as Record<string, unknown>),
      children: childrenOf.get(String(guardian._id)) ?? [],
    }));
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const guardian = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('villageId', 'nameLo nameEn')
      .exec();
    if (!guardian) throw AppException.notFound();
    return guardian;
  }

  /**
   * The students this guardian is linked to.
   *
   * Queried from the student side via the `guardians.guardianId` index — the
   * relationship is embedded there, so there is no join table to consult.
   */
  async findChildren(id: string) {
    await this.assertExists(id);
    return this.studentModel
      .find({ 'guardians.guardianId': new Types.ObjectId(id), deletedAt: null })
      .select('studentCode firstNameLo lastNameLo status guardians')
      .exec();
  }

  create(dto: CreateGuardianDto, context: CrudContext) {
    return this.createDocument(
      {
        ...dto,
        villageId: dto.villageId ? new Types.ObjectId(dto.villageId) : null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      } as Partial<GuardianDocument>,
      context,
    );
  }

  /**
   * Updates a guardian and re-syncs the fields denormalized onto students.
   *
   * `students.guardians[]` carries a copy of `fullNameLo` and `phone` so class
   * lists and report cards can show a contact without a lookup. This method is
   * the single place those copies are refreshed, and it does so in the same
   * transaction as the guardian write — see docs/schema-design.md §3.1.
   */
  async update(id: string, dto: UpdateGuardianDto, context: GuardianWriteContext) {
    await this.assertMayWrite(id, context.actor);

    return this.tx.run(async (session) => {
      const before = await this.findOneOrFail(id, session);

      const patch: Record<string, unknown> = { ...dto };
      if (dto.villageId) patch.villageId = new Types.ObjectId(dto.villageId);
      if (dto.dateOfBirth) patch.dateOfBirth = new Date(dto.dateOfBirth);

      const updated = await this.updateDocument(id, patch, { ...context, session });

      const nameChanged = dto.firstNameLo !== undefined || dto.lastNameLo !== undefined;
      const phoneChanged = dto.phone !== undefined && dto.phone !== before.phone;

      if (nameChanged || phoneChanged) {
        await this.syncDenormalizedFields(updated, session);
      }

      return updated;
    });
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    // Guardians are referenced from students; removing one that is still linked
    // would leave a student with a dangling contact.
    const linked = await this.studentModel
      .exists({ 'guardians.guardianId': new Types.ObjectId(id), deletedAt: null })
      .exec();
    if (linked) {
      throw AppException.conflict('common.inUse', {
        reason: 'guardian is still linked to one or more students',
      });
    }
    await this.softDelete(id, context);
  }

  /**
   * A homeroom teacher may correct only the guardians of their own children.
   *
   * A guardian with a child in the teacher's room and another child elsewhere is
   * still theirs to correct: it is one person with one phone, and the sibling's
   * record picks the change up through the sync below.
   */
  private async assertMayWrite(id: string, actor?: AuthenticatedUser): Promise<void> {
    if (!actor) return;

    const homeroom = await this.scope.homeroomStudentIds(actor);
    if (homeroom === null) return;

    const linked =
      Types.ObjectId.isValid(id) &&
      homeroom.length > 0 &&
      (await this.studentModel
        .exists({
          _id: { $in: homeroom },
          'guardians.guardianId': new Types.ObjectId(id),
          deletedAt: null,
        })
        .exec());
    if (!linked) throw AppException.forbidden('guardian.notInHomeroom');
  }

  /** Pushes the current name and phone into every student that links this guardian. */
  private async syncDenormalizedFields(
    guardian: GuardianDocument,
    session: ClientSession,
  ): Promise<void> {
    await this.studentModel
      .updateMany(
        { 'guardians.guardianId': guardian._id },
        {
          $set: {
            // The positional filter updates only the matching array element.
            'guardians.$[link].fullNameLo': `${guardian.firstNameLo} ${guardian.lastNameLo}`,
            'guardians.$[link].phone': guardian.phone,
          },
        },
        {
          arrayFilters: [{ 'link.guardianId': guardian._id }],
          session,
        },
      )
      .exec();
  }
}
