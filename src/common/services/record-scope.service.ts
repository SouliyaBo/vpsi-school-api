import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Student, StudentDocument, StudentSchema } from 'src/database/schemas';
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
 * Staff roles are returned unrestricted — for them the resource permission is
 * the whole of the policy.
 */
@Injectable()
export class RecordScopeService {
  constructor(@InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>) {}

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
}

/**
 * Global so every student-scoped module can inject the service without adding
 * an import edge — the same reasoning as audit logs and notifications.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Student.name, schema: StudentSchema }])],
  providers: [RecordScopeService],
  exports: [RecordScopeService],
})
export class RecordScopeModule {}
