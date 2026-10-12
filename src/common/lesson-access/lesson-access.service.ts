import { Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  LessonSubstitution,
  LessonSubstitutionDocument,
  LessonSubstitutionSchema,
  TeachingAssignment,
  TeachingAssignmentDocument,
  TeachingAssignmentSchema,
} from 'src/database/schemas';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import {
  canWriteLesson,
  periodsOnDate,
  substitutionKey,
  type LessonSubstitute,
  type SubstitutionIndex,
} from './lesson-write-access';

/** The lesson a write is about, plus the claim that allowed it, if any. */
export interface WritableLesson {
  assignment: TeachingAssignmentDocument;
  /**
   * The live claim on this lesson-day, or `null`.
   *
   * Returned rather than merely consulted so the caller can stamp
   * `substituteTeacherId` on what it writes. The office recording on a teacher's
   * behalf sees the claim too, which is the point: a stand-in's cover is a fact
   * about the lesson, not about who happened to key it in.
   */
  substitution: LessonSubstitutionDocument | null;
}

/**
 * The reads behind "whose lesson is this".
 *
 * Both per-lesson logs resolved and authorized their own lesson, in two copies of
 * the same function, and the behaviour register asked a third, subtly different
 * question when a row was edited. Substitution would have had to be added to all
 * three, and the one that was forgotten would have been the bug — a stand-in able
 * to file a register row and then unable to correct it. So the rule moved here,
 * and the services are a call each.
 *
 * Declares its own two models rather than importing the modules that own them,
 * for the reason `RecordScopeModule` does: it is imported by modules that already
 * import each other's neighbours, and a service edge here would close a cycle.
 */
@Injectable()
export class LessonAccessService {
  constructor(
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignmentDocument>,
    @InjectModel(LessonSubstitution.name)
    private readonly substitutionModel: Model<LessonSubstitutionDocument>,
  ) {}

  /**
   * Loads the lesson a write is about and refuses it unless the actor may.
   *
   * Four separate refusals, deliberately not collapsed: a lesson that does not
   * exist, one the office has switched off, a date the lesson is not taught on,
   * and an actor with no claim to it. Each of them is a different thing for the
   * teacher holding the screen to do about it.
   */
  async resolveWritableLesson(
    teachingAssignmentId: string,
    date: Date,
    actor: AuthenticatedUser,
  ): Promise<WritableLesson> {
    const assignment = await this.resolveLesson(teachingAssignmentId, date);

    // Read on every write, not only when the actor needs it to get in: the claim
    // is also what the row is stamped with, and the office keying a lesson in on
    // a stand-in's behalf has to produce the same row the stand-in would have.
    const substitution = await this.liveSubstitution(assignment._id, date);

    if (!canWriteLesson({ teacherId: assignment.teacherId.toString() }, actor, substitution)) {
      throw AppException.forbidden('attendance.notAssignedTeacher', {
        teachingAssignmentId,
        date: date.toISOString().slice(0, 10),
      });
    }

    return { assignment, substitution };
  }

  /**
   * The lesson itself: live, switched on, and taught on that weekday.
   *
   * Separate from the authorization above because claiming cover asks exactly
   * these three questions and not the fourth — the whole point of a claim is that
   * the claimant is *not* yet allowed to write the lesson.
   */
  async resolveLesson(
    teachingAssignmentId: string,
    date: Date,
  ): Promise<TeachingAssignmentDocument> {
    if (!Types.ObjectId.isValid(teachingAssignmentId)) throw AppException.notFound();

    const assignment = await this.assignmentModel
      .findOne({ _id: new Types.ObjectId(teachingAssignmentId), deletedAt: null })
      .exec();
    if (!assignment) throw AppException.notFound();

    if (!assignment.isActive) {
      throw AppException.badRequest('attendance.assignmentInactive', { teachingAssignmentId });
    }

    if (periodsOnDate(assignment.schedule, date).length === 0) {
      throw AppException.badRequest('attendance.lessonNotScheduled', {
        teachingAssignmentId,
        dayOfWeek: date.getUTCDay(),
        scheduledDays: [...new Set(assignment.schedule.map((period) => period.dayOfWeek))].sort(),
      });
    }

    return assignment;
  }

  /**
   * Whether this actor may write against an already-filed row.
   *
   * The register edits and withdraws by row rather than by lesson, and the row
   * carries the two teachers rather than the timetable. Asked of the stored row so
   * a claim withdrawn since it was filed cannot lock the person who wrote it out
   * of their own entry — the row says who stood in, and that is what is checked.
   */
  canWriteRecord(
    record: { teacherId: Types.ObjectId; substituteTeacherId?: Types.ObjectId | null },
    actor: AuthenticatedUser,
  ): boolean {
    return canWriteLesson(
      { teacherId: String(record.teacherId) },
      actor,
      record.substituteTeacherId
        ? { substituteTeacherId: String(record.substituteTeacherId) }
        : null,
    );
  }

  /** The live claim on one lesson-day, or `null`. */
  async liveSubstitution(
    teachingAssignmentId: Types.ObjectId | string,
    date: Date,
    session?: ClientSession,
  ): Promise<LessonSubstitutionDocument | null> {
    return this.substitutionModel
      .findOne({
        teachingAssignmentId: new Types.ObjectId(String(teachingAssignmentId)),
        date,
        deletedAt: null,
      })
      .session(session ?? null)
      .exec();
  }

  /**
   * Every claim in a window, keyed by lesson-day — what the reports attribute by.
   *
   * Named here rather than in each report because both of them need the stand-in's
   * name formatted the way `loadCoverageAssignments` formats the timetabled
   * teacher's: a report whose substitute rows read differently from its ordinary
   * rows is a report the office has to translate in its head.
   */
  async substitutionIndex(scope: {
    semesterId?: Types.ObjectId | string | null;
    from: Date;
    to: Date;
    classroomId?: string | null;
  }): Promise<SubstitutionIndex> {
    const filter: Record<string, unknown> = {
      date: { $gte: scope.from, $lte: scope.to },
      deletedAt: null,
    };
    if (scope.semesterId) filter.semesterId = new Types.ObjectId(String(scope.semesterId));
    if (scope.classroomId) filter.classroomId = new Types.ObjectId(scope.classroomId);

    const claims = await this.substitutionModel
      .find(filter)
      .populate('substituteTeacherId', 'teacherCode firstNameLo lastNameLo')
      .lean()
      .exec();

    const index = new Map<string, LessonSubstitute>();
    for (const claim of claims) {
      const teacher = claim.substituteTeacherId as unknown as {
        _id: Types.ObjectId;
        teacherCode?: string | null;
        firstNameLo: string;
        lastNameLo: string;
      } | null;
      // A claim whose teacher has since been soft-deleted leaves the populate
      // null. Skipped rather than reported nameless, which hands the day back to
      // the timetabled teacher — the same call `loadCoverageAssignments` makes.
      if (!teacher) continue;

      index.set(substitutionKey(String(claim.teachingAssignmentId), claim.date), {
        teacherId: teacher._id.toString(),
        teacherCode: teacher.teacherCode ?? null,
        teacherName: `${teacher.firstNameLo} ${teacher.lastNameLo}`.trim(),
      });
    }

    return index;
  }

  /**
   * The lessons one teacher covered inside a window.
   *
   * Both reports narrow the timetable by teacher in the database, which selects on
   * the *timetabled* teacher — so without this a stand-in's own report would be
   * missing exactly the lessons they are now answerable for, and the reminder they
   * get would name none of them.
   */
  async coveredAssignmentIds(teacherId: string, from: Date, to: Date): Promise<string[]> {
    if (!Types.ObjectId.isValid(teacherId)) return [];

    const claims = await this.substitutionModel
      .find({
        substituteTeacherId: new Types.ObjectId(teacherId),
        date: { $gte: from, $lte: to },
        deletedAt: null,
      })
      .select('teachingAssignmentId')
      .lean()
      .exec();

    return [...new Set(claims.map((claim) => String(claim.teachingAssignmentId)))];
  }
}

/**
 * Not global, unlike `RecordScopeModule`: the modules that need this are the two
 * per-lesson logs and the claim endpoint itself, and an explicit import edge is
 * what makes `module-wiring.spec.ts` able to say so.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeachingAssignment.name, schema: TeachingAssignmentSchema },
      { name: LessonSubstitution.name, schema: LessonSubstitutionSchema },
    ]),
  ],
  providers: [LessonAccessService],
  exports: [LessonAccessService, MongooseModule],
})
export class LessonAccessModule {}
