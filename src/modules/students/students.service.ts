import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { StudentStatus } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import {
  Enrollment,
  EnrollmentDocument,
  Guardian,
  GuardianDocument,
  Location,
  LocationDocument,
  SchoolYear,
  SchoolYearDocument,
  Student,
  StudentDocument,
  StudentGuardianLink,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { StorageService } from '../storage/storage.service';
import type { WithPhotoUrl } from '../teachers/teachers.service';
import { escapeRegex } from '../users/users.service';
import {
  CreateStudentDto,
  QueryStudentsDto,
  SetStudentGuardiansDto,
  StudentGuardianInputDto,
  UpdateStudentDto,
} from './dto/student.dto';

/**
 * Where a student currently sits, as returned alongside each student row.
 *
 * Classroom placement lives in the `enrollments` collection, so a student list
 * cannot show it without a second read. Clients used to have no way to display it
 * at all — only to filter by it — which forced one request per row.
 */
export interface StudentPlacement {
  enrollmentId: string;
  classroomId: string;
  classroomName: string;
  gradeLevelId: string;
  gradeLevelCode: string | null;
  schoolYearId: string;
  rollNumber: number | null;
  enrolledAt: string;
}

/** A student row with its placement resolved. `null` means "not placed yet". */
export interface StudentListRow extends Record<string, unknown> {
  currentEnrollment: StudentPlacement | null;
}

/** What a child can be on the day they are entered on the register. */
const INTAKE_STATUSES: StudentStatus[] = ['new', 'active'];

/**
 * The write context every students route supplies.
 *
 * `CrudContext.actor` carries only the id and username, which is all the audit
 * trail needs. The homeroom rules need the caller's identity and permission set
 * as well, and the controllers already hand over the whole authenticated user —
 * this only tells the type system so.
 */
export interface StudentWriteContext extends CrudContext {
  actor?: AuthenticatedUser;
}

/** The guardian two students have in common, and how the sibling relates to them. */
export interface SharedGuardian {
  guardianId: string;
  fullNameLo: string;
  relationship: string;
}

export interface SiblingRow extends StudentListRow {
  sharedGuardians: SharedGuardian[];
}

@Injectable()
export class StudentsService extends BaseCrudService<StudentDocument> {
  protected readonly entityType = 'students';
  protected readonly sortableFields = [
    'studentCode',
    'lastNameLo',
    'firstNameLo',
    'dateOfBirth',
    'admissionDate',
    'createdAt',
  ] as const;
  protected readonly defaultSort = { lastNameLo: 1 as const };

  constructor(
    @InjectModel(Student.name) model: Model<StudentDocument>,
    @InjectModel(Guardian.name) private readonly guardianModel: Model<GuardianDocument>,
    @InjectModel(Location.name) private readonly locationModel: Model<LocationDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    audit: AuditLogsService,
    private readonly scope: RecordScopeService,
    private readonly storage: StorageService,
    private readonly tx: TransactionHelper,
  ) {
    super(model, audit);
  }

  /**
   * `actor` is optional only so the signature stays usable from a context with
   * no request behind it; every route passes one, and omitting it means no
   * homeroom scoping is applied.
   */
  async findAll(
    query: QueryStudentsDto,
    actor?: AuthenticatedUser,
  ): Promise<PaginatedResponse<StudentListRow>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    // Constraints on `_id` can come from two independent places (the
    // classroom/grade filters and the placement filter); collected here so the
    // second never silently overwrites the first.
    const idConstraints: Record<string, unknown>[] = [];
    // The current roll is what a list of students is for, so `active` is the
    // default rather than the whole register — a graduated or transferred child
    // stays on file and reachable by id, but no longer turns up in a roster, a
    // picker, or a headcount unless asked for by name. `all` opts out.
    if (query.status !== 'all') filter.status = query.status ?? 'active';
    if (query.gender) filter.gender = query.gender;
    if (query.villageId) filter.villageId = new Types.ObjectId(query.villageId);
    if (query.guardianId) {
      filter['guardians.guardianId'] = new Types.ObjectId(query.guardianId);
    }

    if (query.locationId) {
      filter.villageId = { $in: await this.resolveVillageIds(query.locationId) };
    }

    // Grade level and classroom live on the enrollment, not the student, so
    // these filters resolve to a set of student ids first.
    if (query.classroomId || query.gradeLevelId) {
      const enrollmentFilter: Record<string, unknown> = { status: 'active', deletedAt: null };
      if (query.classroomId) enrollmentFilter.classroomId = new Types.ObjectId(query.classroomId);
      if (query.gradeLevelId) {
        enrollmentFilter.gradeLevelId = new Types.ObjectId(query.gradeLevelId);
      }
      const enrollments = await this.enrollmentModel
        .find(enrollmentFilter)
        .select('studentId')
        .lean()
        .exec();
      idConstraints.push({ $in: enrollments.map((e) => e.studentId) });
    }

    // Placement filter: `enrolled=false` is the queue of students still to be
    // placed, which is the first thing anyone needs at the start of a term.
    if (query.enrolled !== undefined) {
      const schoolYearId = await this.resolvePlacementYear(query.schoolYearId);

      if (!schoolYearId) {
        // No school year to place anyone in yet: nobody is enrolled, so
        // `enrolled=true` is empty and `enrolled=false` is everyone.
        if (query.enrolled) idConstraints.push({ $in: [] });
      } else {
        const placed = await this.enrollmentModel
          .find({ schoolYearId, status: 'active', deletedAt: null })
          .select('studentId')
          .lean()
          .exec();
        const placedIds = placed.map((enrollment) => enrollment.studentId);
        idConstraints.push(query.enrolled ? { $in: placedIds } : { $nin: placedIds });
      }
    }

    // A homeroom teacher's own children, and nobody else's. Pushed as another
    // `_id` constraint so it intersects with — rather than replaces — whatever
    // the client filtered by.
    const homeroom = await this.scope.homeroomStudentIds(actor, query.schoolYearId);
    if (homeroom) idConstraints.push({ $in: homeroom });

    if (idConstraints.length === 1) filter._id = idConstraints[0];
    else if (idConstraints.length > 1) {
      filter.$and = idConstraints.map((constraint) => ({ _id: constraint }));
    }

    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { firstNameLo: { $regex: escaped, $options: 'i' } },
        { lastNameLo: { $regex: escaped, $options: 'i' } },
        { studentCode: { $regex: escaped, $options: 'i' } },
        // Staff look a child up by what they are called, not by the register.
        { nickname: { $regex: escaped, $options: 'i' } },
        { nicknameEn: { $regex: escaped, $options: 'i' } },
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

    const rows = await this.withPlacements(data, query.schoolYearId);
    return new PaginatedResponse(rows, total, query.page, query.limit);
  }

  /**
   * Attaches each student's active placement.
   *
   * One extra query per page, keyed on the ids already fetched — deliberately not
   * an `$lookup` in the main pipeline, which would have to run before `skip`/
   * `limit` and so join across the whole collection to return 20 rows.
   */
  private async withPlacements(
    students: StudentDocument[],
    schoolYearId?: string,
  ): Promise<StudentListRow[]> {
    if (students.length === 0) return [];

    const year = await this.resolvePlacementYear(schoolYearId);

    const enrollments = await this.enrollmentModel
      .find({
        studentId: { $in: students.map((student) => student._id) },
        status: 'active',
        deletedAt: null,
        ...(year ? { schoolYearId: year } : {}),
      })
      .populate('classroomId', 'name')
      .populate('gradeLevelId', 'code')
      .lean()
      .exec();

    const byStudent = new Map<string, StudentPlacement>();
    for (const enrollment of enrollments) {
      const classroom = enrollment.classroomId as unknown as { _id: Types.ObjectId; name?: string };
      const gradeLevel = enrollment.gradeLevelId as unknown as {
        _id: Types.ObjectId;
        code?: string;
      };

      byStudent.set(String(enrollment.studentId), {
        enrollmentId: String(enrollment._id),
        classroomId: String(classroom?._id ?? enrollment.classroomId),
        classroomName: classroom?.name ?? '',
        gradeLevelId: String(gradeLevel?._id ?? enrollment.gradeLevelId),
        gradeLevelCode: gradeLevel?.code ?? null,
        schoolYearId: String(enrollment.schoolYearId),
        rollNumber: enrollment.rollNumber ?? null,
        enrolledAt: new Date(enrollment.enrolledAt).toISOString(),
      });
    }

    return students.map((student) => ({
      ...(student.toJSON() as Record<string, unknown>),
      currentEnrollment: byStudent.get(String(student._id)) ?? null,
    }));
  }

  /** The year the placement filters and projection apply to. */
  private async resolvePlacementYear(schoolYearId?: string): Promise<Types.ObjectId | null> {
    if (schoolYearId) return new Types.ObjectId(schoolYearId);

    const active = await this.schoolYearModel
      .findOne({ isActive: true, deletedAt: null })
      .select('_id')
      .lean()
      .exec();

    return active?._id ?? null;
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const student = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('villageId', 'nameLo nameEn ancestors')
      .populate('guardians.guardianId', 'firstNameLo lastNameLo phone occupation email')
      .exec();
    if (!student) throw AppException.notFound();
    return student;
  }

  async findOneWithPhotoUrl(id: string): Promise<WithPhotoUrl> {
    const student = await this.findOne(id);
    return {
      ...student.toJSON(),
      photoUrl: await this.storage.getSignedUrl(student.photoKey),
    };
  }

  /**
   * Reads one student, enforcing self-access for non-staff callers.
   *
   * A student account may only read its own record; a guardian account only the
   * records of students it is linked to *and* permitted to view. Staff roles
   * pass on the resource permission alone.
   *
   * This lives here rather than in the controller because it needs the typed
   * `guardians` array, and because a rule this consequential should sit next to
   * the data access it guards.
   */
  async findOneForActor(id: string, actor: AuthenticatedUser): Promise<WithPhotoUrl> {
    const student = await this.findOne(id);
    await this.assertMayRead(student, actor);

    return {
      ...student.toJSON(),
      photoUrl: await this.storage.getSignedUrl(student.photoKey),
    };
  }

  private async assertMayRead(student: StudentDocument, actor: AuthenticatedUser): Promise<void> {
    if (actor.personType === 'student' && actor.personId !== String(student._id)) {
      throw AppException.forbidden();
    }

    if (actor.personType === 'guardian') {
      const isPermittedGuardian = student.guardians.some(
        (link) => this.linkedGuardianId(link) === actor.personId && link.canViewRecords,
      );
      if (!isPermittedGuardian) throw AppException.forbidden();
    }

    // Without this the list scope would be cosmetic: a homeroom teacher could
    // still read any child by guessing an id.
    const homeroom = await this.scope.homeroomStudentIds(actor);
    if (homeroom && !homeroom.some((id) => String(id) === String(student._id))) {
      throw AppException.forbidden();
    }
  }

  /**
   * A homeroom teacher may write only to their own students.
   *
   * Separate from `assertMayRead` because the read rules also cover student and
   * guardian accounts, neither of which holds `students:update` and so can never
   * reach a write route at all.
   */
  private async assertMayWrite(id: string, actor?: AuthenticatedUser): Promise<void> {
    if (!actor) return;

    const homeroom = await this.scope.homeroomStudentIds(actor);
    if (homeroom && !homeroom.some((studentId) => String(studentId) === id)) {
      throw AppException.forbidden('student.notInHomeroom');
    }
  }

  /**
   * The other students who share a guardian with this one.
   *
   * There is no sibling field and deliberately none: a family is already
   * expressed by the guardian both children are linked to, and a second link
   * maintained by hand would be one more thing to fall out of step with the
   * first. The trade is that siblings are only as reliable as guardian
   * deduplication — one parent entered twice is two families as far as this
   * query is concerned.
   *
   * Oldest first, and every status is returned: a brother who has already
   * graduated is still the reason the office is asking.
   */
  async findSiblings(id: string, actor: AuthenticatedUser): Promise<SiblingRow[]> {
    const student = await this.findOne(id);
    await this.assertMayRead(student, actor);

    const guardianIds = student.guardians.map(
      (link) => new Types.ObjectId(this.linkedGuardianId(link)),
    );
    if (guardianIds.length === 0) return [];

    const siblings = await this.model
      .find({
        _id: { $ne: student._id },
        'guardians.guardianId': { $in: guardianIds },
        deletedAt: null,
      })
      .sort({ dateOfBirth: 1 })
      .exec();

    // `withPlacements` preserves order, so a sibling and its row share an index.
    const rows = await this.withPlacements(siblings);
    const shared = new Set(guardianIds.map(String));

    return rows.map((row, index) => ({
      ...row,
      sharedGuardians: siblings[index].guardians
        .filter((link) => shared.has(this.linkedGuardianId(link)))
        .map((link) => ({
          guardianId: this.linkedGuardianId(link),
          fullNameLo: link.fullNameLo,
          relationship: link.relationship,
        })),
    }));
  }

  /**
   * The guardian's id from a link, whether or not `guardianId` was populated.
   *
   * `findOne` populates it into a document, so a bare `.toString()` would yield
   * the document's string form rather than the id.
   */
  private linkedGuardianId(link: StudentGuardianLink): string {
    // Mongoose's ObjectId also exposes `_id` (returning itself), so reading it
    // first works for both a raw id and a populated document.
    const value = link.guardianId as unknown as { _id?: unknown };
    return String(value?._id ?? link.guardianId);
  }

  /**
   * Creates a student, any brand-new guardians, and the links between them.
   *
   * All of it in one transaction: a student with no guardian, or a guardian
   * created for a student that then failed to save, are both invalid states.
   */
  async create(dto: CreateStudentDto, context: StudentWriteContext): Promise<StudentDocument> {
    // A homeroom teacher enters a newcomer, so the only statuses open to them are
    // the two a newcomer can be in. Everything past that — graduated,
    // transferred, dropped — is the office's to record, exactly as on update.
    if (
      dto.status !== undefined &&
      !INTAKE_STATUSES.includes(dto.status) &&
      (await this.scope.homeroomClassroomIds(context.actor))
    ) {
      throw AppException.forbidden('student.statusIsOfficeOnly', { to: dto.status });
    }

    if (dto.villageId) await this.assertVillage(dto.villageId);
    this.assertExactlyOnePrimary(dto.guardians);

    return this.tx.run(async (session) => {
      const links = await this.resolveGuardianLinks(dto.guardians, session, context);

      // The guardian *inputs* are replaced by the resolved links below, so they
      // must not be spread into the document.
      const { guardians, ...studentFields } = dto;
      void guardians;

      return this.createDocument(
        {
          ...studentFields,
          villageId: dto.villageId ? new Types.ObjectId(dto.villageId) : null,
          dateOfBirth: new Date(dto.dateOfBirth),
          admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : null,
          guardians: links,
        } as Partial<StudentDocument>,
        { ...context, session },
      );
    });
  }

  async update(id: string, dto: UpdateStudentDto, context: StudentWriteContext) {
    // Resolved once and reused for both checks below — it costs two reads.
    const homeroom = await this.scope.homeroomStudentIds(context.actor);
    if (homeroom) {
      if (!homeroom.some((studentId) => String(studentId) === id)) {
        throw AppException.forbidden('student.notInHomeroom');
      }
      await this.assertStatusUnchanged(id, dto);
    }

    if (dto.villageId) await this.assertVillage(dto.villageId);

    const patch: Record<string, unknown> = { ...dto };
    if (dto.villageId) patch.villageId = new Types.ObjectId(dto.villageId);
    if (dto.dateOfBirth) patch.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.admissionDate) patch.admissionDate = new Date(dto.admissionDate);

    return this.updateDocument(id, patch, context);
  }

  /**
   * Refuses a status change from a homeroom teacher.
   *
   * Graduating, transferring or dropping a child drives enrolment, certificates
   * and the placement queue, so it stays an office decision even though the
   * homeroom teacher may correct everything else on the record. Compared against
   * what is stored rather than rejecting the field outright: the edit form posts
   * the whole record back, so an untouched `status` must still go through.
   */
  private async assertStatusUnchanged(id: string, dto: UpdateStudentDto): Promise<void> {
    if (dto.status === undefined) return;

    const current = await this.findOneOrFail(id);
    if (current.status !== dto.status) {
      throw AppException.forbidden('student.statusIsOfficeOnly', {
        from: current.status,
        to: dto.status,
      });
    }
  }

  /** Replaces the guardian list wholesale, creating any new guardians as needed. */
  async setGuardians(
    id: string,
    dto: SetStudentGuardiansDto,
    context: StudentWriteContext,
  ): Promise<StudentDocument> {
    await this.assertMayWrite(id, context.actor);
    this.assertExactlyOnePrimary(dto.guardians);

    return this.tx.run(async (session) => {
      await this.findOneOrFail(id, session);
      const links = await this.resolveGuardianLinks(dto.guardians, session, context);
      return this.updateDocument(id, { guardians: links }, { ...context, session });
    });
  }

  async setPhoto(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    context: StudentWriteContext,
  ): Promise<WithPhotoUrl> {
    await this.assertMayWrite(id, context.actor);
    const student = await this.findOneOrFail(id);
    const previousKey = student.photoKey;

    const uploaded = await this.storage.upload(file, 'photo', `students/${id}`);
    const updated = await this.updateDocument(id, { photoKey: uploaded.key }, context);

    if (previousKey) {
      await this.storage.delete(previousKey).catch(() => undefined);
    }

    return { ...updated.toJSON(), photoUrl: await this.storage.getSignedUrl(uploaded.key) };
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Turns guardian inputs into embedded links, creating guardians that do not
   * yet exist and copying the fields the student document denormalizes.
   */
  private async resolveGuardianLinks(
    inputs: StudentGuardianInputDto[],
    session: ClientSession,
    context: CrudContext,
  ): Promise<StudentGuardianLink[]> {
    const links: StudentGuardianLink[] = [];

    for (const input of inputs) {
      let guardian: GuardianDocument | null;

      if (input.guardianId) {
        guardian = await this.guardianModel
          .findOne({ _id: input.guardianId, deletedAt: null })
          .session(session)
          .exec();
        if (!guardian) {
          throw AppException.badRequest('common.notFound', {
            field: 'guardianId',
            value: input.guardianId,
          });
        }
      } else if (input.guardian) {
        const [created] = await this.guardianModel.create(
          [
            {
              ...input.guardian,
              villageId: input.guardian.villageId
                ? new Types.ObjectId(input.guardian.villageId)
                : null,
              dateOfBirth: input.guardian.dateOfBirth ? new Date(input.guardian.dateOfBirth) : null,
            },
          ],
          { session },
        );
        guardian = created;
        await this.audit.record(
          {
            action: 'create',
            entityType: 'guardians',
            entityId: created._id,
            userId: context.actor?.sub,
            username: context.actor?.username,
            newValue: { phone: created.phone },
            ip: context.ip,
          },
          session,
        );
      } else {
        throw AppException.badRequest('common.validationFailed', {
          reason: 'each guardian entry needs either guardianId or a guardian object',
        });
      }

      links.push({
        guardianId: guardian._id,
        // Denormalized copies; GuardiansService.update() keeps them current.
        fullNameLo: `${guardian.firstNameLo} ${guardian.lastNameLo}`,
        phone: guardian.phone,
        relationship: input.relationship,
        isPrimary: input.isPrimary ?? false,
        isEmergencyContact: input.isEmergencyContact ?? false,
        canViewRecords: input.canViewRecords ?? true,
      });
    }

    return links;
  }

  /**
   * Reports and permission checks assume a single primary contact, so the
   * invariant is enforced on write rather than defended everywhere on read.
   */
  private assertExactlyOnePrimary(guardians: StudentGuardianInputDto[]): void {
    if (guardians.length === 0) throw AppException.badRequest('student.guardianRequired');

    const primaryCount = guardians.filter((g) => g.isPrimary).length;
    if (primaryCount > 1) throw AppException.badRequest('student.multiplePrimaryGuardians');
    if (primaryCount === 0) {
      // Rather than reject, promote the first entry — the caller's intent is clear.
      guardians[0].isPrimary = true;
    }
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

  private async resolveVillageIds(locationId: string): Promise<Types.ObjectId[]> {
    const villages = await this.locationModel
      .find({ ancestors: new Types.ObjectId(locationId), type: 'village', deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return villages.map((v) => v._id);
  }
}
