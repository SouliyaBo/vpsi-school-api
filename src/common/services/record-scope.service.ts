import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Classroom,
  ClassroomDocument,
  ClassroomSchema,
  Enrollment,
  EnrollmentDocument,
  EnrollmentSchema,
  SchoolYear,
  SchoolYearDocument,
  SchoolYearSchema,
  Student,
  StudentDocument,
  StudentSchema,
} from 'src/database/schemas';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Narrows student-scoped reads to the records an actor may actually see.
 *
 * The permission matrix answers "may this role read term results at all"; it
 * cannot answer "*whose*". Students and guardians hold a `read` grant on
 * several student-scoped resources, so without this every one of those list
 * endpoints would hand a student the whole school's data.
 *
 * A homeroom teacher is narrowed too — see `homeroomClassroomIds` — which is a
 * separate axis: not "which child am I", but "which room is mine". Everyone else
 * on staff is returned unrestricted, because for them the resource permission is
 * the whole of the policy.
 */
@Injectable()
export class RecordScopeService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
  ) {}

  /**
   * The students an actor may read, or `null` for "no restriction".
   *
   * `null` and `[]` mean very different things — unrestricted versus nothing at
   * all — so the distinction is deliberate rather than an empty-array shortcut.
   */
  async accessibleStudentIds(actor: AuthenticatedUser): Promise<Types.ObjectId[] | null> {
    if (actor.personType === 'student') {
      return actor.personId ? [new Types.ObjectId(actor.personId)] : [];
    }

    if (actor.personType === 'guardian') {
      if (!actor.personId) return [];

      // `$elemMatch` so both conditions must hold on the *same* link — a
      // guardian linked to one student with viewing rights must not thereby see
      // a different student they are linked to without them.
      const students = await this.studentModel
        .find({
          guardians: {
            $elemMatch: {
              guardianId: new Types.ObjectId(actor.personId),
              canViewRecords: true,
            },
          },
          deletedAt: null,
        })
        .select('_id')
        .lean()
        .exec();

      return students.map((student) => student._id);
    }

    // Teachers and staff: governed by the permission matrix alone.
    return null;
  }

  /** Throws unless the actor may read this particular student's records. */
  async assertCanAccessStudent(actor: AuthenticatedUser, studentId: string): Promise<void> {
    const allowed = await this.accessibleStudentIds(actor);
    if (allowed === null) return;

    if (!allowed.some((id) => id.toString() === studentId)) {
      throw AppException.forbidden();
    }
  }

  /**
   * Applies the scope to a Mongo filter.
   *
   * When the caller already filtered by `studentId`, the two are intersected
   * rather than overwritten — a student passing someone else's id gets an empty
   * result rather than silently seeing their own.
   */
  async applyStudentScope(
    filter: Record<string, unknown>,
    actor: AuthenticatedUser,
    field = 'studentId',
  ): Promise<Record<string, unknown>> {
    const allowed = await this.accessibleStudentIds(actor);
    if (allowed === null) return filter;

    const requested = filter[field];
    if (requested instanceof Types.ObjectId) {
      const permitted = allowed.some((id) => id.equals(requested));
      filter[field] = permitted ? requested : { $in: [] };
      return filter;
    }

    filter[field] = { $in: allowed };
    return filter;
  }

  /** True when the actor is a student or guardian, i.e. subject to scoping. */
  isScoped(actor: AuthenticatedUser): boolean {
    return actor.personType === 'student' || actor.personType === 'guardian';
  }

  // ── Homeroom ──────────────────────────────────────────────────────────────

  /**
   * The classrooms an actor is homeroom teacher of — `ຄູປະຈຳຫ້ອງ` — or `null`
   * when they are not narrowed to a room at all.
   *
   * School-wide roles are exempt: the registrar (`students:manage`) and the
   * academic office and admin (`classrooms:manage`) exist to look across every
   * room, and some of their holders are also teachers with a homeroom of their
   * own, so keying this off `personType` alone would lock them out of their own
   * job. `students:update` cannot be the test — a homeroom teacher holds it too,
   * which is the whole point.
   *
   * `null` and `[]` mean very different things here: unrestricted versus a
   * teacher with no homeroom this year, who sees and touches nothing.
   */
  async homeroomClassroomIds(
    actor: AuthenticatedUser | undefined,
    schoolYearId?: string,
  ): Promise<Types.ObjectId[] | null> {
    if (!actor || actor.personType !== 'teacher' || !actor.personId) return null;

    const seesEveryRoom = actor.permissions.some(
      (permission) =>
        (permission.resource === 'students' &&
          (permission.actions.includes('manage') || permission.actions.includes('delete'))) ||
        (permission.resource === 'classrooms' && permission.actions.includes('manage')),
    );
    if (seesEveryRoom) return null;

    const year = await this.resolveYear(schoolYearId);

    // Matched as both an ObjectId and a string: `Classroom.homeroomTeacherId` is
    // declared `@Prop({ type: Types.ObjectId })`, which NestJS turns into a
    // `Mixed` path rather than an ObjectId one, so a room whose homeroom teacher
    // was set through `PATCH /classrooms/:id` holds the raw string while a seeded
    // one holds an ObjectId. Both are the same teacher and both must match. Drop
    // the string half once the schema declares `SchemaTypes.ObjectId` and the
    // existing rows are migrated.
    const classrooms = await this.classroomModel
      .find({
        homeroomTeacherId: { $in: [new Types.ObjectId(actor.personId), actor.personId] },
        ...(year ? { schoolYearId: year } : {}),
        deletedAt: null,
      })
      .select('_id')
      .lean()
      .exec();

    return classrooms.map((classroom) => classroom._id);
  }

  /** The students sitting in those classrooms, on the same `null` convention. */
  async homeroomStudentIds(
    actor: AuthenticatedUser | undefined,
    schoolYearId?: string,
  ): Promise<Types.ObjectId[] | null> {
    const classroomIds = await this.homeroomClassroomIds(actor, schoolYearId);
    if (classroomIds === null) return null;
    if (classroomIds.length === 0) return [];

    // Placement lives on the enrollment, so the roster is one more read. Bounded
    // by the classrooms above, which already belong to a single school year.
    const enrollments = await this.enrollmentModel
      .find({ classroomId: { $in: classroomIds }, status: 'active', deletedAt: null })
      .select('studentId')
      .lean()
      .exec();

    return enrollments.map((enrollment) => enrollment.studentId);
  }

  /** The year a homeroom is read against; the active one unless asked otherwise. */
  private async resolveYear(schoolYearId?: string): Promise<Types.ObjectId | null> {
    if (schoolYearId) return new Types.ObjectId(schoolYearId);

    const active = await this.schoolYearModel
      .findOne({ isActive: true, deletedAt: null })
      .select('_id')
      .lean()
      .exec();

    return active?._id ?? null;
  }
}

/**
 * Global so every student-scoped module can inject the service without adding
 * an import edge — the same reasoning as audit logs and notifications.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Student.name, schema: StudentSchema },
      // The homeroom scope reads rooms, their rosters, and the year to read them
      // against.
      { name: Classroom.name, schema: ClassroomSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
  ],
  providers: [RecordScopeService],
  exports: [RecordScopeService],
})
export class RecordScopeModule {}
