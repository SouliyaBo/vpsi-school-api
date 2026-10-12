import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { EnrollmentStatus } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import {
  Enrollment,
  EnrollmentDocument,
  SchoolYear,
  SchoolYearDocument,
  Student,
  StudentDocument,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import {
  BulkEnrollDto,
  BulkEnrollResultDto,
  ChangeEnrollmentStatusDto,
  CreateEnrollmentDto,
  QueryEnrollmentsDto,
  UpdateEnrollmentDto,
} from './dto/enrollment.dto';

/**
 * Allowed status transitions.
 *
 * `active` is the only state that can move anywhere; the terminal states are
 * terminal on purpose — a dropped student is re-enrolled with a new enrollment
 * record, which keeps the history of why they left intact.
 */
/**
 * The write context the enrollment routes supply.
 *
 * `CrudContext.actor` carries only what the audit trail needs; placing a student
 * also has to know which rooms the caller owns. The controllers already hand
 * over the whole authenticated user — this only tells the type system so.
 */
export interface EnrollmentWriteContext extends CrudContext {
  actor?: AuthenticatedUser;
}

const ALLOWED_TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  active: ['transferred', 'promoted', 'dropped', 'repeated'],
  transferred: [],
  promoted: [],
  dropped: ['active'], // a student who returns in the same year resumes their place
  repeated: [],
};

@Injectable()
export class EnrollmentsService extends BaseCrudService<EnrollmentDocument> {
  protected readonly entityType = 'enrollments';
  protected readonly sortableFields = ['rollNumber', 'enrolledAt', 'studentCode'] as const;
  protected readonly defaultSort = { rollNumber: 1 as const };
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    @InjectModel(Enrollment.name) model: Model<EnrollmentDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    audit: AuditLogsService,
    private readonly classrooms: ClassroomsService,
    private readonly tx: TransactionHelper,
    private readonly scope: RecordScopeService,
  ) {
    super(model, audit);
  }

  async findAll(query: QueryEnrollmentsDto): Promise<PaginatedResponse<EnrollmentDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.gradeLevelId) filter.gradeLevelId = new Types.ObjectId(query.gradeLevelId);
    if (query.status) filter.status = query.status;
    if (query.englishClass) filter.englishClass = query.englishClass;

    const sort = query.toSort(this.sortableFields, this.defaultSort);
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('classroomId', 'name gradeLevelId')
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

  /** A student's enrollment history, newest year first. */
  async findByStudent(studentId: string) {
    return this.model
      .find({ studentId: new Types.ObjectId(studentId), deletedAt: null })
      .populate('classroomId', 'name')
      .populate('schoolYearId', 'code nameLo')
      .populate('gradeLevelId', 'code nameLo level')
      .sort({ enrolledAt: -1 })
      .exec();
  }

  /**
   * The `ຫ້ອງພາກອັງກິດ` labels actually in use, for a filter to offer.
   *
   * Distinct over the placements themselves rather than a lookup table: the
   * rooms have no register, so the only truth about which exist is which ones
   * the office has written on a child. Sorted so the list reads the same twice
   * running; blanks are dropped, since "no room" is its own filter.
   */
  async listEnglishClasses(schoolYearId?: string): Promise<string[]> {
    const year = schoolYearId ? new Types.ObjectId(schoolYearId) : await this.activeSchoolYearId();

    const labels = await this.model
      .distinct('englishClass', {
        status: 'active',
        deletedAt: null,
        englishClass: { $nin: [null, ''] },
        ...(year ? { schoolYearId: year } : {}),
      })
      .exec();

    return (labels as (string | null)[])
      .filter((label): label is string => Boolean(label))
      .sort((a, b) => a.localeCompare(b));
  }

  /** The class roster, in roll-number order. */
  async findClassRoster(classroomId: string) {
    return (
      this.model
        .find({
          classroomId: new Types.ObjectId(classroomId),
          status: 'active',
          deletedAt: null,
        })
        // `studentNameLo` on the row is the register name snapshotted at placement.
        // The student is joined so a roster can also show what the class calls the
        // child, which is what a teacher reads down the column looking for — and
        // their status, so a caller can tell an enrollment nobody has closed yet
        // from a child still in the room. The rows are not filtered by it here:
        // this is the placement screen's roster, and an enrollment left open
        // behind a departed student is exactly what it exists to fix.
        .populate('studentId', ROSTER_STUDENT_SELECT)
        .sort({ rollNumber: 1 })
        .exec()
    );
  }

  /**
   * Enrolls one student.
   *
   * Transactional because it writes the enrollment and bumps the classroom's
   * cached `currentCount`; if those diverge, capacity checks become meaningless.
   */
  async create(
    dto: CreateEnrollmentDto,
    context: EnrollmentWriteContext,
  ): Promise<EnrollmentDocument> {
    return this.tx.run((session) => this.enrollWithinTransaction(dto, session, context));
  }

  /**
   * Bulk enroll, intended for the CSV/Excel import path.
   *
   * Each row is its own transaction rather than one transaction for the batch:
   * a single bad student code should not discard 499 good rows. The response
   * reports exactly which rows failed and why.
   */
  async bulkEnroll(
    dto: BulkEnrollDto,
    context: EnrollmentWriteContext,
  ): Promise<BulkEnrollResultDto> {
    const result: BulkEnrollResultDto = { enrolled: 0, failed: 0, errors: [] };

    for (const item of dto.items) {
      try {
        const student = await this.studentModel
          .findOne({ studentCode: item.studentCode, deletedAt: null })
          .exec();
        if (!student) {
          throw AppException.badRequest('common.notFound', { field: 'studentCode' });
        }

        await this.tx.run((session) =>
          this.enrollWithinTransaction(
            {
              studentId: student._id.toString(),
              classroomId: item.classroomId,
              englishClass: item.englishClass,
            },
            session,
            context,
          ),
        );
        result.enrolled += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          studentCode: item.studentCode,
          reason:
            error instanceof AppException
              ? `${error.messageKey}${error.details ? ` ${JSON.stringify(error.details)}` : ''}`
              : error instanceof Error
                ? error.message
                : 'unknown error',
        });
      }
    }

    this.logger.log(`Bulk enroll: ${result.enrolled} enrolled, ${result.failed} failed`);
    return result;
  }

  /**
   * Edits the English-programme room on an existing placement.
   *
   * Not transactional: unlike a move this touches nothing but the one row — no
   * headcount, no roll number, no second enrollment.
   */
  async update(
    id: string,
    dto: UpdateEnrollmentDto,
    context: CrudContext,
  ): Promise<EnrollmentDocument> {
    await this.findOneOrFail(id);

    const changes: Partial<EnrollmentDocument> = {};
    // `undefined` means "not sent" and an empty string means "clear it" — the
    // office removing a child from the English programme has to be expressible.
    if (dto.englishClass !== undefined) {
      changes.englishClass = dto.englishClass.trim() || null;
    }

    return this.updateDocument(id, changes, context);
  }

  /**
   * Changes an enrollment's status, keeping classroom counts correct.
   *
   * A transfer creates the destination enrollment and decrements the origin's
   * count in the same transaction, so a student is never counted twice or in
   * neither place.
   */
  async changeStatus(
    id: string,
    dto: ChangeEnrollmentStatusDto,
    context: CrudContext,
  ): Promise<EnrollmentDocument> {
    return this.tx.run(async (session) => {
      const enrollment = await this.findOneOrFail(id, session);

      const allowed = ALLOWED_TRANSITIONS[enrollment.status];
      if (!allowed.includes(dto.status)) {
        throw AppException.badRequest('enrollment.invalidStatusTransition', {
          from: enrollment.status,
          to: dto.status,
          allowed,
        });
      }

      const isTransfer = dto.status === 'transferred' && Boolean(dto.transferredToClassroomId);

      // Check the destination has room before vacating the origin, so a failed
      // transfer leaves the student where they were.
      const destination = isTransfer
        ? await this.classrooms.assertHasSpace(dto.transferredToClassroomId!, session)
        : null;

      // Leaving `active` frees a seat in the origin classroom.
      if (enrollment.status === 'active' && dto.status !== 'active') {
        await this.classrooms.adjustCount(enrollment.classroomId, -1, session);
      }
      // Returning to `active` takes one back.
      if (enrollment.status !== 'active' && dto.status === 'active') {
        await this.classrooms.assertHasSpace(enrollment.classroomId.toString(), session);
        await this.classrooms.adjustCount(enrollment.classroomId, 1, session);
      }

      // The origin must stop being `active` *before* the destination row is
      // created: the unique index allows only one active enrollment per student
      // per year, so creating first would collide with the row we are replacing.
      const updated = await this.updateDocument(
        id,
        {
          status: dto.status,
          statusChangedAt: new Date(),
          statusReason: dto.reason ?? null,
          transferredToClassroomId: dto.transferredToClassroomId
            ? new Types.ObjectId(dto.transferredToClassroomId)
            : null,
        },
        { ...context, session },
      );

      if (destination) {
        await this.model.create(
          [
            {
              studentId: enrollment.studentId,
              studentCode: enrollment.studentCode,
              studentNameLo: enrollment.studentNameLo,
              classroomId: destination._id,
              schoolYearId: destination.schoolYearId,
              gradeLevelId: destination.gradeLevelId,
              enrolledAt: new Date(),
              status: 'active',
              rollNumber: await this.classrooms.nextRollNumber(destination._id, session),
              // The English rooms are not the homerooms, so moving between
              // homerooms says nothing about them. Carried over rather than
              // dropped: a wrong label the office can see and fix beats a blank
              // one nobody notices until the English teacher asks.
              englishClass: enrollment.englishClass ?? null,
            },
          ],
          { session },
        );

        await this.classrooms.adjustCount(destination._id, 1, session);
      }

      return updated;
    });
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    await this.tx.run(async (session) => {
      const enrollment = await this.findOneOrFail(id, session);
      if (enrollment.status === 'active') {
        await this.classrooms.adjustCount(enrollment.classroomId, -1, session);
      }
      await this.softDelete(id, { ...context, session });
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The active school year, or `null` when the school has not opened one. */
  private async activeSchoolYearId(): Promise<Types.ObjectId | null> {
    const active = await this.schoolYearModel
      .findOne({ isActive: true, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return active?._id ?? null;
  }

  /**
   * A homeroom teacher may place a student in their own room and nowhere else.
   *
   * They hold `enrollments:create` only so that adding a newcomer can put them
   * somewhere — without a placement the child is invisible to the very teacher
   * who just entered them. Everyone with a school-wide grant is unscoped.
   */
  private async assertOwnClassroom(classroomId: string, actor?: AuthenticatedUser): Promise<void> {
    const own = await this.scope.homeroomClassroomIds(actor);
    if (own === null) return;

    if (!own.some((id) => String(id) === classroomId)) {
      throw AppException.forbidden('enrollment.notOwnHomeroom', { classroomId });
    }
  }

  private async enrollWithinTransaction(
    dto: CreateEnrollmentDto,
    session: ClientSession,
    context: EnrollmentWriteContext,
  ): Promise<EnrollmentDocument> {
    // The single choke point both `create` and `bulkEnroll` pass through, so a
    // homeroom teacher is held to their own room on either path.
    await this.assertOwnClassroom(dto.classroomId, context.actor);

    const student = await this.studentModel
      .findOne({ _id: dto.studentId, deletedAt: null })
      .session(session)
      .exec();
    if (!student) throw AppException.badRequest('common.notFound', { field: 'studentId' });

    // Graduated or dropped students must be reactivated deliberately before
    // they can be placed in a class.
    if (student.status !== 'active') {
      throw AppException.badRequest('enrollment.studentNotActive', { status: student.status });
    }

    const classroom = await this.classrooms.assertHasSpace(dto.classroomId, session);

    // Mirrors the unique index — one *active* enrollment per student per year.
    // Checked here so the caller gets a domain error rather than a raw
    // duplicate-key conflict. Superseded rows (transferred, dropped) do not
    // block a new placement.
    const existing = await this.model
      .findOne({
        studentId: student._id,
        schoolYearId: classroom.schoolYearId,
        status: 'active',
        deletedAt: null,
      })
      .session(session)
      .exec();
    if (existing) {
      throw AppException.conflict('enrollment.alreadyEnrolled', {
        existingEnrollmentId: existing._id.toString(),
        classroomId: existing.classroomId.toString(),
      });
    }

    const enrollment = await this.createDocument(
      {
        studentId: student._id,
        studentCode: student.studentCode,
        studentNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
        classroomId: classroom._id,
        schoolYearId: classroom.schoolYearId,
        gradeLevelId: classroom.gradeLevelId,
        enrolledAt: dto.enrolledAt ? new Date(dto.enrolledAt) : new Date(),
        status: 'active',
        rollNumber: await this.classrooms.nextRollNumber(classroom._id, session),
        englishClass: dto.englishClass?.trim() || null,
      } as Partial<EnrollmentDocument>,
      { ...context, session },
    );

    await this.classrooms.adjustCount(classroom._id, 1, session);
    return enrollment;
  }
}
