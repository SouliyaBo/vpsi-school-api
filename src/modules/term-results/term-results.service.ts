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
import { LAO_MONTHS, MARK_MAX as MONTHLY_MARK_MAX } from '../monthly-marks/monthly-grading';
import {
  MonthlyMarksService,
  type MonthlySubjectMark,
} from '../monthly-marks/monthly-marks.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { GradingScaleService } from './grading-scale.service';
import { ScoreComponentsService } from '../score-components/score-components.service';
import { SubjectsService } from '../subjects/subjects.service';
import { SettingsService } from '../settings/settings.service';
import { QueryTermResultsDto } from './dto/term-result.dto';
import { resultsDiffer, type ComparableResult, type ComparableSubject } from './result-diff';

/** What `.lean()` gives back for a term result — the fields compared here. */
type LeanTermResult = Pick<
  TermResult,
  | 'average'
  | 'gpa'
  | 'grade'
  | 'subjectsPassed'
  | 'subjectsFailed'
  | 'conductGrade'
  | 'isProvisional'
  | 'rank'
  | 'subjects'
>;
import {
  COMPUTATION_VERSION,
  ComponentInput,
  DEFAULT_PASSING_PERCENTAGE,
  GradeBand,
  assignRanks,
  computeSubjectFromMark,
  computeSubjectResult,
  computeTermResult,
  round2,
} from './grading';

/** A stored result narrowed to the figures a family would notice changing. */
function toComparableResult(stored: TermResultDocument | LeanTermResult): ComparableResult {
  return {
    average: stored.average,
    gpa: stored.gpa,
    grade: stored.grade,
    subjectsPassed: stored.subjectsPassed,
    subjectsFailed: stored.subjectsFailed,
    conductGrade: stored.conductGrade ?? null,
    isProvisional: stored.isProvisional,
    rank: stored.rank ?? null,
    subjects: stored.subjects.map(toComparableSubject),
  };
}

/** The fields of a subject a family would notice changing. */
function toComparableSubject(subject: {
  subjectId: Types.ObjectId | string;
  percentage: number;
  grade: string;
  isPassed: boolean;
  isIncomplete?: boolean;
}): ComparableSubject {
  return {
    subjectId: subject.subjectId.toString(),
    percentage: subject.percentage,
    grade: subject.grade,
    isPassed: subject.isPassed,
    isIncomplete: subject.isIncomplete ?? false,
  };
}

/** How the sheet names its two term-level figures, as printed on a report card. */
const EXAM_LABEL_LO = 'ສອບເສັງພາກ';
const BONUS_LABEL_LO = 'ເພີ່ມ';

export interface ComputeSummary {
  classroomId: string;
  semesterId: string;
  studentsProcessed: number;
  provisionalCount: number;
  /**
   * Published results the recomputation moved, and which are therefore no longer
   * published. They have to be released again deliberately.
   */
  withdrawn: number;
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
    private readonly gradingScale: GradingScaleService,
    private readonly classrooms: ClassroomsService,
    private readonly subjects: SubjectsService,
    private readonly components: ScoreComponentsService,
    private readonly monthlyMarks: MonthlyMarksService,
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
    const scale = await this.gradingScale.resolve();
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
      withdrawn: 0,
      skipped: [],
    };

    // Subject metadata is shared across the whole class — fetch once.
    const subjectCache = new Map<string, SubjectDocument>();

    /**
     * The school's own 10-point sheet, for the whole class in two queries.
     *
     * Most subjects here are marked on it rather than on weighted components, so
     * this is the primary source and the components are the fallback — see
     * `subjectFromMonthlyMark`. Loaded outside the loop because it is one read
     * for the class, not one per student.
     */
    const monthlyByStudent = await this.monthlyMarks.getClassroomSubjectMarks(
      classroomId,
      semesterId,
    );

    /**
     * How many subjects this grade is marked in — the divisor for the average.
     *
     * The school adds the subject marks up and divides by the number of subjects
     * the grade sits: 4 at ມ.1–ມ.3, 8 at ມ.4 and ມ.7, 7 at ມ.5 and ມ.6. Read from
     * the register once for the class rather than inferred per student, so a
     * student missing a subject reads as short of it rather than as complete.
     */
    const classroom = await this.classrooms.findOneOrFail(classroomId);
    const expectedSubjects = (await this.subjects.findMarkedForGradeLevel(classroom.gradeLevelId))
      .length;

    const computed: {
      studentId: string;
      average: number;
      documentId: Types.ObjectId;
      previousRank: number | null;
      isPublished: boolean;
    }[] = [];

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

        const monthly = monthlyByStudent.get(enrollment.studentId.toString()) ?? [];
        const monthlyBySubject = new Map(monthly.map((row) => [row.subjectId, row]));

        if (scores.length === 0 && monthly.length === 0) {
          summary.skipped.push({
            studentId: enrollment.studentId.toString(),
            reason: 'no scores recorded',
          });
          continue;
        }

        // Group the student's component scores by subject.
        const bySubject = new Map<string, typeof scores>();
        for (const score of scores) {
          const key = score.subjectId.toString();
          bySubject.set(key, [...(bySubject.get(key) ?? []), score]);
        }

        const subjectResults: TermResultSubject[] = [];

        // Both instruments, one list of subjects: a school part-way through the
        // move from components to the monthly sheet has some of each, and a
        // report card that showed only one of them would be missing subjects.
        const subjectIds = new Set([...bySubject.keys(), ...monthlyBySubject.keys()]);

        for (const subjectId of subjectIds) {
          const subjectScores = bySubject.get(subjectId) ?? [];
          let subject = subjectCache.get(subjectId);
          if (!subject) {
            const loaded = await this.subjectModel.findById(subjectId).exec();
            if (!loaded) continue;
            subject = loaded;
            subjectCache.set(subjectId, loaded);
          }

          const monthlyMark = monthlyBySubject.get(subjectId);
          if (monthlyMark) {
            // Marked on the school's own sheet: ພາກຮຽນ is the whole story, and
            // there are no weights left to check.
            subjectResults.push(
              this.subjectFromMonthlyMark(monthlyMark, subject, scale, defaultPassing),
            );
            continue;
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
          { scale, expectedSubjects },
        );

        const [conductGrade, attendance] = await Promise.all([
          this.conduct.resolveSemesterGrade(enrollment.studentId, new Types.ObjectId(semesterId)),
          this.attendances.getStudentSummary(enrollment.studentId.toString(), semesterId),
        ]);

        // A subject with no marks at all is as provisional as a half-marked one:
        // the average divided by the eight subjects ມ.4 sits, so a student short
        // of one reads low until it arrives.
        const isProvisional =
          subjectResults.some((s) => s.isIncomplete) ||
          term.subjectsRecorded < term.subjectsExpected;
        if (isProvisional) summary.provisionalCount += 1;

        // Read before writing: a published result that the recomputation moves
        // has to be withdrawn, and that cannot be decided from the new figures
        // alone.
        const existing = await this.model
          .findOne({
            studentId: enrollment.studentId,
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
          })
          .lean()
          .exec();

        const next = {
          average: term.average,
          gpa: term.gpa,
          grade: term.grade,
          subjectsPassed: term.subjectsPassed,
          subjectsFailed: term.subjectsFailed,
          conductGrade,
          isProvisional,
          rank: existing?.rank ?? null,
          subjects: subjectResults.map(toComparableSubject),
        };

        /**
         * Publication is withdrawn rather than quietly overwritten.
         *
         * A result a family has already been shown is a statement the school
         * made. Recomputing it in place would change that statement with nothing
         * to show for it — so when the figures actually move, the result goes
         * back to unpublished and has to be released again deliberately. A
         * recomputation that changes nothing leaves publication alone, which is
         * what keeps "rerun the class after one correction" safe.
         */
        const withdrawn =
          Boolean(existing?.isPublished) && resultsDiffer(toComparableResult(existing!), next);
        if (withdrawn) summary.withdrawn += 1;

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
                subjectsExpected: term.subjectsExpected,
                subjectsRecorded: term.subjectsRecorded,
                conductGrade,
                daysPresent: attendance.present,
                // ວັນຂາດ as the office counts it: three lates are a day absent,
                // and the lates left over are what still reads as late.
                daysAbsent: attendance.absentUnexcused,
                daysLate: attendance.lateRemainder,
                daysExcused: attendance.absentExcused,
                isProvisional,
                computedAt: new Date(),
                computationVersion: COMPUTATION_VERSION,
                deletedAt: null,
                // Freshly computed from the marks as they stand.
                isStale: false,
                staleSince: null,
                ...(withdrawn
                  ? { isPublished: false, publishedAt: null, unpublishedAt: new Date() }
                  : {}),
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();

        computed.push({
          studentId: enrollment.studentId.toString(),
          average: term.average,
          documentId: saved._id,
          previousRank: existing?.rank ?? null,
          isPublished: saved.isPublished,
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

    summary.withdrawn += await this.applyRanks(computed);

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
        withdrawn: summary.withdrawn,
        skippedCount: summary.skipped.length,
        computationVersion: COMPUTATION_VERSION,
      },
      reason:
        summary.withdrawn > 0
          ? `term results computed; publication withdrawn from ${summary.withdrawn} changed result(s)`
          : 'term results computed',
    });

    this.logger.log(
      `Computed term results for classroom ${classroomId}: ` +
        `${summary.studentsProcessed} processed, ${summary.skipped.length} skipped, ` +
        `${summary.withdrawn} withdrawn from publication`,
    );

    return summary;
  }

  /**
   * Publishes a classroom's results.
   *
   * Two kinds of result are held back, for the same reason: releasing a figure
   * that is going to change is worse than releasing nothing.
   *
   *  - **provisional** — computed from marks that are not all in;
   *  - **stale** — a mark has changed since the result was computed, so the
   *    stored figure is already out of date and publishing it would put a number
   *    in front of a family that the register no longer agrees with.
   *
   * The second is why `isStale` exists: without it, publishing after a late
   * correction quietly released yesterday's arithmetic.
   */
  async publish(
    classroomId: string,
    semesterId: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ published: number; withheld: number; withheldStale: number }> {
    const filter = {
      classroomId: new Types.ObjectId(classroomId),
      semesterId: new Types.ObjectId(semesterId),
      deletedAt: null,
    };

    const [provisional, stale] = await Promise.all([
      this.model.countDocuments({ ...filter, isProvisional: true }).exec(),
      this.model.countDocuments({ ...filter, isProvisional: false, isStale: true }).exec(),
    ]);

    const outcome = await this.model
      .updateMany(
        { ...filter, isProvisional: false, isStale: false, isPublished: false },
        { $set: { isPublished: true, publishedAt: new Date() } },
      )
      .exec();

    await this.audit.record({
      action: 'update',
      entityType: 'termResults',
      userId: actor.sub,
      username: actor.username,
      newValue: {
        classroomId,
        semesterId,
        published: outcome.modifiedCount,
        withheldProvisional: provisional,
        withheldStale: stale,
      },
      ip,
      reason:
        stale > 0
          ? `term results published; ${stale} withheld as out of date since the last computation`
          : 'term results published',
    });

    return {
      published: outcome.modifiedCount,
      withheld: provisional + stale,
      withheldStale: stale,
    };
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

  /**
   * One subject as the monthly sheet marked it, in the shape the report card
   * reads.
   *
   * The months and the exam are carried through as components so a report card
   * can print the breakdown the school actually recognises — ກັນຍາ, ຕຸລາ, ພະຈິກ,
   * ສອບເສັງ — rather than a bare term mark. Their weights say how the mark was
   * arrived at: the three months share half of it and the exam is the other half.
   *
   * `ເພີ່ມ` is carried at weight zero, because that is what it is: points added on
   * top of a mark that is already out of 10, not a share of it.
   */
  private subjectFromMonthlyMark(
    mark: MonthlySubjectMark,
    subject: SubjectDocument,
    scale: readonly GradeBand[],
    defaultPassing: number,
  ): TermResultSubject {
    const outcome = computeSubjectFromMark(mark.mark, mark.isComplete, {
      scale,
      passingPercentage: subject.passingPercentage ?? defaultPassing,
    });

    const monthWeight = mark.monthScores.length > 0 ? round2(50 / mark.monthScores.length) : 0;
    const components = [
      ...mark.monthScores.map((month) => ({
        componentId: null,
        nameLo: LAO_MONTHS[month.month] ?? String(month.month),
        score: month.score,
        maxScore: MONTHLY_MARK_MAX,
        weight: monthWeight,
        weightedScore: round2(((month.score ?? 0) / MONTHLY_MARK_MAX) * monthWeight),
      })),
      {
        componentId: null,
        nameLo: EXAM_LABEL_LO,
        score: mark.examScore,
        maxScore: MONTHLY_MARK_MAX,
        weight: 50,
        weightedScore: round2(((mark.examScore ?? 0) / MONTHLY_MARK_MAX) * 50),
      },
      ...(mark.bonus
        ? [
            {
              componentId: null,
              nameLo: BONUS_LABEL_LO,
              score: mark.bonus,
              maxScore: MONTHLY_MARK_MAX,
              weight: 0,
              weightedScore: round2(mark.bonus * 10),
            },
          ]
        : []),
    ];

    return {
      subjectId: subject._id,
      subjectNameLo: subject.nameLo,
      credits: subject.credits,
      components,
      ...outcome,
    } as TermResultSubject;
  }

  /**
   * Writes ranks in one bulk operation once every average is known.
   *
   * A rank is printed on the report card and is not a property of the student
   * alone — one late correction two rows up moves it. So a published result whose
   * rank changes is withdrawn here on the same terms as one whose marks changed:
   * the card in the family's hands no longer says what the school says.
   */
  private async applyRanks(
    computed: {
      studentId: string;
      average: number;
      documentId: Types.ObjectId;
      previousRank: number | null;
      isPublished: boolean;
    }[],
  ): Promise<number> {
    if (computed.length === 0) return 0;

    const ranks = assignRanks(computed);
    const totalStudents = computed.length;
    let withdrawn = 0;

    await this.model.bulkWrite(
      computed.map((entry) => {
        const rank = ranks.get(entry.studentId) ?? null;
        const rankMoved = entry.isPublished && rank !== entry.previousRank;
        if (rankMoved) withdrawn += 1;

        return {
          updateOne: {
            filter: { _id: entry.documentId },
            update: {
              $set: {
                rank,
                totalStudents,
                ...(rankMoved
                  ? { isPublished: false, publishedAt: null, unpublishedAt: new Date() }
                  : {}),
              },
            },
          },
        };
      }),
    );

    return withdrawn;
  }

  private async resolvePassingPercentage(): Promise<number> {
    const configured = await this.settings.getValue<number>('grading.passingPercentage');
    return typeof configured === 'number' ? configured : DEFAULT_PASSING_PERCENTAGE;
  }
}
