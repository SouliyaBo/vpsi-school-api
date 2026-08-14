import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  Enrollment,
  EnrollmentDocument,
  Score,
  ScoreDocument,
  Subject,
  SubjectDocument,
  TermResult,
  TermResultDocument,
  TermResultSubject,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { AttendancesService } from '../attendances/attendances.service';
import { ConductScoresService } from '../conduct-scores/conduct-scores.service';
import { ScoreComponentsService } from '../score-components/score-components.service';
import { SettingsService } from '../settings/settings.service';
import { QueryTermResultsDto } from './dto/term-result.dto';
import {
  COMPUTATION_VERSION,
  ComponentInput,
  DEFAULT_GRADE_SCALE,
  DEFAULT_PASSING_PERCENTAGE,
  GradeBand,
  assignRanks,
  computeSubjectResult,
  computeTermResult,
} from './grading';

export interface ComputeSummary {
  classroomId: string;
  semesterId: string;
  studentsProcessed: number;
  provisionalCount: number;
  skipped: { studentId: string; reason: string }[];
}

@Injectable()
export class TermResultsService {
  private readonly logger = new Logger(TermResultsService.name);

  constructor(
    @InjectModel(TermResult.name) private readonly model: Model<TermResultDocument>,
    @InjectModel(Score.name) private readonly scoreModel: Model<ScoreDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    private readonly components: ScoreComponentsService,
    private readonly conduct: ConductScoresService,
    private readonly attendances: AttendancesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
  ) {}

  async findAll(
    query: QueryTermResultsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<TermResultDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.isPublished !== undefined) filter.isPublished = query.isPublished;

    // A student or guardian holds `term-results:read`, which says nothing about
    // *whose* results. Without this they would list the whole school.
    await this.scope.applyStudentScope(filter, actor);
    if (this.scope.isScoped(actor)) filter.isPublished = true;

    const sort = query.toSort(['average', 'rank', 'gpa'], { rank: 1 });
    const [data, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(query.skip).limit(query.limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * A student's result, gated on publication.
   *
   * Students and guardians must not see a mark before the school releases it;
   * staff with `term-results:manage` can see provisional results in order to
   * check them.
   */
  async findForStudent(
    studentId: string,
    semesterId: string,
    actor: AuthenticatedUser,
  ): Promise<TermResultDocument> {
    // Checked before the lookup, so the response cannot differ depending on
    // whether a record exists for a student the caller may not read.
    await this.scope.assertCanAccessStudent(actor, studentId);

    const result = await this.model
      .findOne({
        studentId: new Types.ObjectId(studentId),
        semesterId: new Types.ObjectId(semesterId),
        deletedAt: null,
      })
      .exec();

    if (!result) throw AppException.notFound();

    const canSeeUnpublished = actor.permissions.some(
      (p) => p.resource === 'term-results' && p.actions.includes('manage'),
    );
    if (!result.isPublished && !canSeeUnpublished) {
      throw AppException.forbidden('termResult.notPublished');
    }

    return result;
  }

  /**
   * Recomputes every term result for a classroom, then ranks the class.
   *
   * Ranking has to happen after all the averages exist, so this is one operation
   * over the whole classroom rather than per student. It is the unit the queue
   * job schedules.
   *
   * Idempotent: running it twice produces the same stored results, so a retried
   * job is harmless.
   */
  async computeForClassroom(
    classroomId: string,
    semesterId: string,
    actor?: Pick<AuthenticatedUser, 'sub' | 'username'>,
  ): Promise<ComputeSummary> {
    const scale = await this.resolveGradeScale();
    const defaultPassing = await this.resolvePassingPercentage();

    const roster = await this.enrollmentModel
      .find({
        classroomId: new Types.ObjectId(classroomId),
        status: 'active',
        deletedAt: null,
      })
      .lean()
      .exec();

    if (roster.length === 0) {
      throw AppException.badRequest('termResult.noScores', {
        reason: 'classroom has no actively enrolled students',
      });
    }

    const summary: ComputeSummary = {
      classroomId,
      semesterId,
      studentsProcessed: 0,
      provisionalCount: 0,
      skipped: [],
    };

    // Subject metadata is shared across the whole class — fetch once.
    const subjectCache = new Map<string, SubjectDocument>();

    const computed: { studentId: string; average: number; documentId: Types.ObjectId }[] = [];

    for (const enrollment of roster) {
      try {
        const scores = await this.scoreModel
          .find({
            studentId: enrollment.studentId,
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
          })
          .populate<{ componentId: { _id: Types.ObjectId; nameLo: string; weight: number } }>(
            'componentId',
            'nameLo weight',
          )
          .lean()
          .exec();

        if (scores.length === 0) {
          summary.skipped.push({
            studentId: enrollment.studentId.toString(),
            reason: 'no scores recorded',
          });
          continue;
        }

        // Group the student's scores by subject.
        const bySubject = new Map<string, typeof scores>();
        for (const score of scores) {
          const key = score.subjectId.toString();
          bySubject.set(key, [...(bySubject.get(key) ?? []), score]);
        }

        const subjectResults: TermResultSubject[] = [];

        for (const [subjectId, subjectScores] of bySubject) {
          let subject = subjectCache.get(subjectId);
          if (!subject) {
            const loaded = await this.subjectModel.findById(subjectId).exec();
            if (!loaded) continue;
            subject = loaded;
            subjectCache.set(subjectId, loaded);
          }

          // Weights must total 100 for the mark to mean anything.
          await this.components.assertWeightsValid(subjectId, semesterId, classroomId);

          /**
           * Inputs are built from the subject's **defined components**, not from
           * the score rows that happen to exist.
           *
           * A component nobody has marked yet has no score document at all. Were
           * we to iterate the scores instead, that component would simply be
           * absent, the subject would look fully graded, and a partial mark would
           * be publishable as final. Iterating the components makes the gap
           * visible: the missing one contributes `score: null`, which flags the
           * result incomplete and holds it back from publication.
           */
          const definedComponents = await this.components.findForSubjectAndClassroom(
            subjectId,
            semesterId,
            classroomId,
          );

          const scoreByComponent = new Map(
            subjectScores.map((score) => [score.componentId._id.toString(), score]),
          );

          const inputs: ComponentInput[] = definedComponents.map((component) => {
            const score = scoreByComponent.get(component._id.toString());
            return {
              componentId: component._id.toString(),
              nameLo: component.nameLo,
              score: score?.score ?? null,
              // Fall back to the component's own maximum when no score row exists.
              maxScore: score?.maxScore ?? component.maxScore,
              weight: component.weight,
              isAbsent: score?.isAbsent ?? false,
            };
          });

          const outcome = computeSubjectResult(inputs, {
            scale,
            passingPercentage: subject.passingPercentage ?? defaultPassing,
          });

          subjectResults.push({
            subjectId: subject._id,
            subjectNameLo: subject.nameLo,
            credits: subject.credits,
            components: outcome.components.map((c) => ({
              componentId: new Types.ObjectId(c.componentId),
              nameLo: c.nameLo,
              score: c.score,
              maxScore: c.maxScore,
              weight: c.weight,
              weightedScore: c.weightedScore,
            })),
            percentage: outcome.percentage,
            grade: outcome.grade,
            gradePoint: outcome.gradePoint,
            isPassed: outcome.isPassed,
            isIncomplete: outcome.isIncomplete,
          });
        }

        if (subjectResults.length === 0) {
          summary.skipped.push({
            studentId: enrollment.studentId.toString(),
            reason: 'no computable subjects',
          });
          continue;
        }

        const term = computeTermResult(
          subjectResults.map((s) => ({
            credits: s.credits,
            percentage: s.percentage,
            gradePoint: s.gradePoint,
            isPassed: s.isPassed,
          })),
          scale,
        );

        const [conductGrade, attendance] = await Promise.all([
          this.conduct.resolveSemesterGrade(enrollment.studentId, new Types.ObjectId(semesterId)),
          this.attendances.getStudentSummary(enrollment.studentId.toString(), semesterId),
        ]);

        const isProvisional = subjectResults.some((s) => s.isIncomplete);
        if (isProvisional) summary.provisionalCount += 1;

        const saved = await this.model
          .findOneAndUpdate(
            {
              studentId: enrollment.studentId,
              semesterId: new Types.ObjectId(semesterId),
            },
            {
              $set: {
                studentCode: enrollment.studentCode,
                studentNameLo: enrollment.studentNameLo,
                schoolYearId: enrollment.schoolYearId,
                classroomId: new Types.ObjectId(classroomId),
                subjects: subjectResults,
                average: term.average,
                gpa: term.gpa,
                grade: term.grade,
                subjectsPassed: term.subjectsPassed,
                subjectsFailed: term.subjectsFailed,
                conductGrade,
                daysPresent: attendance.present,
                daysAbsent: attendance.absent,
                daysLate: attendance.late,
                daysExcused: attendance.excused + attendance.sick,
                isProvisional,
                computedAt: new Date(),
                computationVersion: COMPUTATION_VERSION,
                deletedAt: null,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();

        computed.push({
          studentId: enrollment.studentId.toString(),
          average: term.average,
          documentId: saved._id,
        });
        summary.studentsProcessed += 1;
      } catch (error) {
        summary.skipped.push({
          studentId: enrollment.studentId.toString(),
          reason:
            error instanceof AppException
              ? error.messageKey
              : error instanceof Error
                ? error.message
                : 'unknown error',
        });
      }
    }

    await this.applyRanks(computed);

    await this.audit.record({
      action: 'update',
      entityType: 'termResults',
      userId: actor?.sub,
      username: actor?.username,
      newValue: {
        classroomId,
        semesterId,
        studentsProcessed: summary.studentsProcessed,
        provisionalCount: summary.provisionalCount,
        skippedCount: summary.skipped.length,
        computationVersion: COMPUTATION_VERSION,
      },
      reason: 'term results computed',
    });

    this.logger.log(
      `Computed term results for classroom ${classroomId}: ` +
        `${summary.studentsProcessed} processed, ${summary.skipped.length} skipped`,
    );

    return summary;
  }

  /**
   * Publishes a classroom's results.
   *
   * Provisional results are held back — releasing a mark computed from partial
   * scores would show a student a grade that is going to change.
   */
  async publish(
    classroomId: string,
    semesterId: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ published: number; withheld: number }> {
    const filter = {
      classroomId: new Types.ObjectId(classroomId),
      semesterId: new Types.ObjectId(semesterId),
      deletedAt: null,
    };

    const withheld = await this.model.countDocuments({ ...filter, isProvisional: true }).exec();

    const outcome = await this.model
      .updateMany(
        { ...filter, isProvisional: false, isPublished: false },
        { $set: { isPublished: true, publishedAt: new Date() } },
      )
      .exec();

    await this.audit.record({
      action: 'update',
      entityType: 'termResults',
      userId: actor.sub,
      username: actor.username,
      newValue: { classroomId, semesterId, published: outcome.modifiedCount, withheld },
      ip,
      reason: 'term results published',
    });

    return { published: outcome.modifiedCount, withheld };
  }

  /** Class ranking, newest computation first. */
  async getClassRanking(classroomId: string, semesterId: string) {
    return this.model
      .find({
        classroomId: new Types.ObjectId(classroomId),
        semesterId: new Types.ObjectId(semesterId),
        deletedAt: null,
      })
      .select('studentId studentCode studentNameLo average gpa grade rank totalStudents')
      .sort({ rank: 1 })
      .exec();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Writes ranks in one bulk operation once every average is known. */
  private async applyRanks(
    computed: { studentId: string; average: number; documentId: Types.ObjectId }[],
  ): Promise<void> {
    if (computed.length === 0) return;

    const ranks = assignRanks(computed);
    const totalStudents = computed.length;

    await this.model.bulkWrite(
      computed.map((entry) => ({
        updateOne: {
          filter: { _id: entry.documentId },
          update: { $set: { rank: ranks.get(entry.studentId) ?? null, totalStudents } },
        },
      })),
    );
  }

  /** Grade boundaries from settings, falling back to the built-in scale. */
  private async resolveGradeScale(): Promise<readonly GradeBand[]> {
    const configured = await this.settings.getValue<GradeBand[]>('grading.scale');
    if (!Array.isArray(configured) || configured.length === 0) return DEFAULT_GRADE_SCALE;

    const isValid = configured.every(
      (band) =>
        typeof band?.grade === 'string' &&
        typeof band?.minPercentage === 'number' &&
        typeof band?.gradePoint === 'number',
    );
    if (!isValid) {
      this.logger.warn('Setting "grading.scale" is malformed; using the default scale');
      return DEFAULT_GRADE_SCALE;
    }

    // `gradeFor` takes the first matching band, so the scale must run high to low.
    return [...configured].sort((a, b) => b.minPercentage - a.minPercentage);
  }

  private async resolvePassingPercentage(): Promise<number> {
    const configured = await this.settings.getValue<number>('grading.passingPercentage');
    return typeof configured === 'number' ? configured : DEFAULT_PASSING_PERCENTAGE;
  }
}
