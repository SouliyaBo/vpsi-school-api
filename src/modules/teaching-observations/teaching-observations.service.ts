import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  Semester,
  SemesterDocument,
  Subject,
  SubjectDocument,
  Teacher,
  TeacherDocument,
  TeachingObservation,
  TeachingObservationDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateTeachingObservationDto,
  NextVisitQueryDto,
  ObservationSummaryQueryDto,
  QueryTeachingObservationsDto,
  UpdateTeachingObservationDto,
} from './dto/teaching-observation.dto';
import {
  computeTotals,
  CRITERION_MAX_SCORE,
  mergeScores,
  normalizeScores,
  OBSERVATION_CRITERIA,
  OBSERVATION_MAX_TOTAL,
  unscoredCriteria,
  type ScoreInput,
} from './observation-rubric';

/** Enough of a teacher to write their name at the head of a sheet. */
const TEACHER_NAME = 'teacherCode title firstNameLo lastNameLo firstNameEn lastNameEn';

const SUBJECT_NAME = 'code nameLo nameEn subjectGroupId gradeLevelId';

/** The joins every read of a sheet needs — it is a form with six named blanks. */
const SHEET_POPULATE = [
  { path: 'teacherId', select: TEACHER_NAME },
  { path: 'observerId', select: TEACHER_NAME },
  { path: 'subjectId', select: SUBJECT_NAME },
  { path: 'subjectGroupId', select: 'code nameLo nameEn' },
  { path: 'classroomId', select: 'name gradeLevelId' },
  { path: 'semesterId', select: 'nameLo nameEn isActive' },
] as const;

const SORTABLE = ['observedAt', 'visitNumber', 'totalScore', 'createdAt'] as const;

/** One teacher's line of ສະຫຼຸບການຕິດຕາມ — the term's visits, averaged. */
export interface TeacherObservationSummary {
  teacherId: string;
  teacherCode: string;
  teacherNameLo: string;
  teacherNameEn: string | null;
  subjectGroupId: string | null;
  /** Sheets that have actually been filed — drafts are nobody's record. */
  visitCount: number;
  /** How many of those the teacher has confirmed reading. */
  acknowledgedCount: number;
  /** Mean of ລວມຄະແນນປະເມີນ across the filed sheets, one decimal. */
  averageTotal: number | null;
  /** Out of 60 — restated so a caller need not know the rubric's size. */
  maxTotal: number;
  /** Mean mark per criterion, keyed by rubric key; `null` where never marked. */
  averageByCriterion: Record<string, number | null>;
  lastObservedAt: string | null;
}

/**
 * The four fields a ຄັ້ງທີ is counted within.
 *
 * One observer's run of visits to one teacher's subject, inside a term. Anything
 * outside this tuple starts its own count at 1, which is what lets two observers
 * each file their own ຄັ້ງທີ 1 about the same teacher. The classroom is not part
 * of it: the same lesson taught to a second room is the run's next visit.
 */
interface VisitScope {
  teacherId: Types.ObjectId;
  observerId: Types.ObjectId;
  subjectId: Types.ObjectId;
  semesterId: Types.ObjectId;
}

/** What the form shows in ປະເມີນຄັ້ງທີ before anything has been typed. */
export interface NextVisitNumber {
  visitNumber: number;
  semesterId: string;
}

export interface ObservationSummary {
  semester: { id: string; nameLo: string; nameEn: string | null };
  maxTotal: number;
  criteria: typeof OBSERVATION_CRITERIA;
  teachers: TeacherObservationSummary[];
}

/**
 * ຕິດຕາມການສອນຂອງຄູ — the classroom-observation sheet.
 *
 * The school's paper form heads each sheet with the teacher observed, the
 * department, the subject, the room, the date and the visit number, then scores
 * six criteria out of ten. What it never records is who did the observing, which
 * is the one thing that turns a stack of sheets into something the academic
 * office can stand behind — so `observerId` is required here, and defaults to
 * the signed-in teacher rather than being left to be typed.
 *
 * A sheet is drafted at the back of the room and filed afterwards. Until it is
 * filed it belongs to its observer alone; once filed it is a record about a
 * colleague, editable by nobody, and the observed teacher can mark that they
 * have read it — the digital form of the signature the paper is passed back for.
 */
@Injectable()
export class TeachingObservationsService {
  constructor(
    @InjectModel(TeachingObservation.name)
    private readonly model: Model<TeachingObservationDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    private readonly audit: AuditLogsService,
  ) {}

  /** The printed form itself, so the client renders the school's wording. */
  rubric() {
    return {
      criteria: OBSERVATION_CRITERIA,
      criterionMaxScore: CRITERION_MAX_SCORE,
      maxTotal: OBSERVATION_MAX_TOTAL,
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async findAll(
    query: QueryTeachingObservationsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<unknown>> {
    const filter: FilterQuery<TeachingObservationDocument> = { deletedAt: null };

    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);
    if (query.observerId) filter.observerId = new Types.ObjectId(query.observerId);
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.subjectGroupId) filter.subjectGroupId = new Types.ObjectId(query.subjectGroupId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.observedAt = {
        ...(query.from ? { $gte: toUtcMidnight(query.from) } : {}),
        ...(query.to ? { $lte: toUtcMidnight(query.to) } : {}),
      };
    }

    this.applyVisibility(filter, actor);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate([...SHEET_POPULATE])
        .sort(query.toSort(SORTABLE, { observedAt: -1 }))
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<TeachingObservationDocument> {
    const sheet = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate([...SHEET_POPULATE])
      .exec();

    if (!sheet) throw AppException.notFound();
    this.assertMayRead(sheet, actor);
    return sheet;
  }

  /**
   * ສະຫຼຸບການຕິດຕາມ — every teacher visited this term, with their averages.
   *
   * Only filed sheets are counted. A draft is the observer's working copy and
   * nobody else can see it, so letting one move a teacher's average would put a
   * figure on the academic head's screen that its own author had not yet stood
   * behind.
   *
   * Aggregated in the database rather than in memory because the summary is read
   * far more often than it is written and grows with every visit of every term.
   */
  async summary(
    query: ObservationSummaryQueryDto,
    actor: AuthenticatedUser,
  ): Promise<ObservationSummary> {
    const semester = await this.resolveSemester(query.semesterId);

    const filter: FilterQuery<TeachingObservationDocument> = {
      deletedAt: null,
      semesterId: semester._id,
      status: { $in: ['submitted', 'acknowledged'] },
    };
    if (query.subjectGroupId) filter.subjectGroupId = new Types.ObjectId(query.subjectGroupId);
    this.applyVisibility(filter, actor);

    const rows = await this.model
      .find(filter)
      .select('teacherId subjectGroupId scores totalScore status observedAt')
      .populate({ path: 'teacherId', select: TEACHER_NAME })
      .lean()
      .exec();

    const byTeacher = new Map<
      string,
      {
        teacher: Record<string, unknown>;
        subjectGroupId: string | null;
        totals: number[];
        acknowledged: number;
        lastObservedAt: Date | null;
        perCriterion: Map<string, number[]>;
      }
    >();

    for (const row of rows) {
      // A sheet whose teacher was hard-deleted has nothing to summarize under.
      const teacher = row.teacherId as unknown as { _id: Types.ObjectId } | null;
      if (!teacher?._id) continue;

      const key = String(teacher._id);
      const entry = byTeacher.get(key) ?? {
        teacher: teacher as unknown as Record<string, unknown>,
        subjectGroupId: row.subjectGroupId ? String(row.subjectGroupId) : null,
        totals: [],
        acknowledged: 0,
        lastObservedAt: null,
        perCriterion: new Map<string, number[]>(),
      };

      entry.totals.push(row.totalScore ?? 0);
      if (row.status === 'acknowledged') entry.acknowledged += 1;
      if (!entry.lastObservedAt || row.observedAt > entry.lastObservedAt) {
        entry.lastObservedAt = row.observedAt;
      }
      for (const score of (row.scores ?? []) as ScoreInput[]) {
        if (score.score === null || score.score === undefined) continue;
        const marks = entry.perCriterion.get(score.criterion) ?? [];
        marks.push(score.score);
        entry.perCriterion.set(score.criterion, marks);
      }

      byTeacher.set(key, entry);
    }

    const teachers = [...byTeacher.entries()]
      .map(([teacherId, entry]) => ({
        teacherId,
        teacherCode: String(entry.teacher.teacherCode ?? ''),
        teacherNameLo:
          `${entry.teacher.firstNameLo ?? ''} ${entry.teacher.lastNameLo ?? ''}`.trim(),
        teacherNameEn:
          entry.teacher.firstNameEn || entry.teacher.lastNameEn
            ? `${entry.teacher.firstNameEn ?? ''} ${entry.teacher.lastNameEn ?? ''}`.trim()
            : null,
        subjectGroupId: entry.subjectGroupId,
        visitCount: entry.totals.length,
        acknowledgedCount: entry.acknowledged,
        averageTotal: mean(entry.totals),
        maxTotal: OBSERVATION_MAX_TOTAL,
        averageByCriterion: Object.fromEntries(
          OBSERVATION_CRITERIA.map((criterion) => [
            criterion.key,
            mean(entry.perCriterion.get(criterion.key) ?? []),
          ]),
        ),
        lastObservedAt: entry.lastObservedAt ? entry.lastObservedAt.toISOString() : null,
      }))
      // Lowest average first: the summary exists to find who needs support, and
      // a list that opens on the school's best teacher answers nobody's question.
      .sort((a, b) => (a.averageTotal ?? Infinity) - (b.averageTotal ?? Infinity));

    return {
      semester: {
        id: String(semester._id),
        nameLo: semester.nameLo,
        nameEn: semester.nameEn ?? null,
      },
      maxTotal: OBSERVATION_MAX_TOTAL,
      criteria: OBSERVATION_CRITERIA,
      teachers,
    };
  }

  /**
   * ປະເມີນຄັ້ງທີ the form should show before anything is typed.
   *
   * The number is derived on create anyway; this endpoint exists so the observer
   * can *see* it while filling the head of the sheet, because the field is also
   * typeable — somebody copying a paper sheet headed ຄັ້ງທີ 2 must be able to
   * say so. Left to guess, they type the number on their own paper and collide
   * with a colleague's sheet, which is the whole reason this changed.
   *
   * The classroom is not asked for: it is not part of the count, so the number
   * is answerable as soon as the teacher and the subject are named.
   *
   * `resolveObserver` rather than a raw id: who a teacher may count for is the
   * same rule as who they may file as, and it is not restated here.
   */
  async nextVisit(query: NextVisitQueryDto, actor: AuthenticatedUser): Promise<NextVisitNumber> {
    const semester = await this.resolveSemester(query.semesterId);
    const observerId = await this.resolveObserver(query.observerId, actor);

    const visitNumber = await this.nextVisitNumber({
      teacherId: new Types.ObjectId(query.teacherId),
      observerId,
      subjectId: new Types.ObjectId(query.subjectId),
      semesterId: semester._id as Types.ObjectId,
    });

    return { visitNumber, semesterId: String(semester._id) };
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  async create(
    dto: CreateTeachingObservationDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<TeachingObservationDocument> {
    const semester = await this.resolveSemester(dto.semesterId);
    const observerId = await this.resolveObserver(dto.observerId, actor);

    const teacher = await this.teacherModel
      .findOne({ _id: dto.teacherId, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (!teacher) throw AppException.notFound('common.notFound', { field: 'teacherId' });

    // An observer marking their own lesson is not an observation, and a sheet
    // like that would quietly inflate the department's averages.
    if (observerId.equals(teacher._id)) {
      throw AppException.badRequest('observation.selfObservation');
    }

    const subject = await this.subjectModel
      .findOne({ _id: dto.subjectId, deletedAt: null })
      .select('subjectGroupId')
      .lean()
      .exec();
    if (!subject) throw AppException.notFound('common.notFound', { field: 'subjectId' });

    const scores = normalizeScores(dto.scores ?? []);
    const totals = computeTotals(scores);
    const scope: VisitScope = {
      teacherId: teacher._id,
      observerId,
      subjectId: new Types.ObjectId(dto.subjectId),
      semesterId: semester._id as Types.ObjectId,
    };
    const visitNumber = dto.visitNumber ?? (await this.nextVisitNumber(scope));

    const created = await this.model
      .create({
        ...scope,
        recordedById: new Types.ObjectId(actor.sub),
        subjectGroupId: subject.subjectGroupId ?? null,
        classroomId: new Types.ObjectId(dto.classroomId),
        observedAt: toUtcMidnight(dto.observedAt),
        visitNumber,
        scores,
        totalScore: totals.totalScore,
        maxScore: totals.maxScore,
        note: dto.note ?? null,
        status: 'draft',
      })
      .catch((error: unknown) => {
        throw this.asDuplicateVisit(error, visitNumber);
      });

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'create',
      entityType: 'TeachingObservation',
      entityId: created._id,
      newValue: { teacherId: String(teacher._id), observerId: String(observerId), visitNumber },
      ip,
    });

    return this.findOne(String(created._id), actor);
  }

  /**
   * Corrects a draft.
   *
   * Only while it is a draft, and only by its observer (or the office). Once
   * filed, a sheet is a statement one member of staff made about another on a
   * given day: a wrong one is withdrawn and rewritten, not quietly edited into
   * a different judgement under the same heading.
   */
  async update(
    id: string,
    dto: UpdateTeachingObservationDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<TeachingObservationDocument> {
    const sheet = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!sheet) throw AppException.notFound();

    this.assertMayWrite(sheet, actor);
    if (sheet.status !== 'draft') {
      throw AppException.conflict('observation.alreadySubmitted');
    }

    const before = {
      totalScore: sheet.totalScore,
      observerId: String(sheet.observerId),
      visitNumber: sheet.visitNumber,
    };

    /** The scope the sheet is in now, to compare against where the edit puts it. */
    const wasIn = visitScopeKey(sheet);

    if (dto.observerId) {
      sheet.observerId = await this.resolveObserver(dto.observerId, actor);
      if (sheet.observerId.equals(sheet.teacherId)) {
        throw AppException.badRequest('observation.selfObservation');
      }
    }
    if (dto.classroomId) sheet.classroomId = new Types.ObjectId(dto.classroomId);
    if (dto.observedAt) sheet.observedAt = toUtcMidnight(dto.observedAt);
    if (dto.note !== undefined) sheet.note = dto.note || null;

    if (dto.subjectId) {
      const subject = await this.subjectModel
        .findOne({ _id: dto.subjectId, deletedAt: null })
        .select('subjectGroupId')
        .lean()
        .exec();
      if (!subject) throw AppException.notFound('common.notFound', { field: 'subjectId' });
      sheet.subjectId = new Types.ObjectId(dto.subjectId);
      sheet.subjectGroupId = subject.subjectGroupId ?? null;
    }

    if (dto.scores) {
      const merged = mergeScores(sheet.scores, dto.scores);
      const totals = computeTotals(merged);
      sheet.scores = merged;
      sheet.totalScore = totals.totalScore;
      sheet.maxScore = totals.maxScore;
    }

    /**
     * A draft moved to another observer or subject is renumbered.
     *
     * ຄັ້ງທີ counts within one observer's visits to one subject, so carrying the
     * old number across would either collide with a sheet already filed in the
     * new scope or claim a visit that never happened there. The sheet itself is
     * excluded from the count — it is arriving, not already present. Correcting
     * the room changes nothing, since the room is not part of the count.
     */
    if (visitScopeKey(sheet) !== wasIn) {
      sheet.visitNumber = await this.nextVisitNumber(
        {
          teacherId: sheet.teacherId,
          observerId: sheet.observerId,
          subjectId: sheet.subjectId,
          semesterId: sheet.semesterId,
        },
        sheet._id,
      );
    }

    await sheet.save().catch((error: unknown) => {
      throw this.asDuplicateVisit(error, sheet.visitNumber);
    });

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'TeachingObservation',
      entityId: sheet._id,
      oldValue: before,
      newValue: {
        totalScore: sheet.totalScore,
        observerId: String(sheet.observerId),
        visitNumber: sheet.visitNumber,
      },
      ip,
    });

    return this.findOne(id, actor);
  }

  /**
   * Files the sheet.
   *
   * Refused unless all six criteria carry a mark. A sheet with a blank row still
   * produces a total, and that total would sit in the same column as everybody
   * else's out of sixty while being out of fifty — which is how an averages table
   * ends up quietly punishing the teachers whose observer ran out of time.
   */
  async submit(
    id: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<TeachingObservationDocument> {
    const sheet = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!sheet) throw AppException.notFound();

    this.assertMayWrite(sheet, actor);
    if (sheet.status !== 'draft') {
      throw AppException.conflict('observation.alreadySubmitted');
    }

    const missing = unscoredCriteria(sheet.scores);
    if (missing.length > 0) {
      throw AppException.badRequest('observation.incompleteSheet', {
        criteria: missing.join(', '),
      });
    }

    sheet.status = 'submitted';
    sheet.submittedAt = new Date();
    await sheet.save();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'approve',
      entityType: 'TeachingObservation',
      entityId: sheet._id,
      newValue: { status: 'submitted', totalScore: sheet.totalScore },
      ip,
    });

    return this.findOne(id, actor);
  }

  /**
   * The observed teacher confirms they have read it.
   *
   * Theirs alone, including against the office: "the teacher has seen this" is
   * the one fact on the sheet that nobody but the teacher can supply, and a
   * system that let an administrator tick it would be recording an assertion
   * about somebody else's knowledge.
   */
  async acknowledge(
    id: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<TeachingObservationDocument> {
    const sheet = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!sheet) throw AppException.notFound();

    if (actor.personType !== 'teacher' || !actor.personId) {
      throw AppException.forbidden('observation.notTheObservedTeacher');
    }
    if (!sheet.teacherId.equals(new Types.ObjectId(actor.personId))) {
      throw AppException.forbidden('observation.notTheObservedTeacher');
    }
    if (sheet.status === 'draft') {
      throw AppException.conflict('observation.notYetSubmitted');
    }
    if (sheet.status === 'acknowledged') return this.findOne(id, actor);

    sheet.status = 'acknowledged';
    sheet.acknowledgedAt = new Date();
    await sheet.save();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'approve',
      entityType: 'TeachingObservation',
      entityId: sheet._id,
      newValue: { status: 'acknowledged' },
      ip,
    });

    return this.findOne(id, actor);
  }

  /**
   * Withdraws a sheet.
   *
   * Soft-deleted like every other record here, so a withdrawn judgement stays
   * auditable — the interesting question about a sheet that vanished is usually
   * who made it vanish. Withdrawing a filed sheet is the office's, since by then
   * the observed teacher may already have read it.
   */
  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const sheet = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!sheet) throw AppException.notFound();

    if (sheet.status !== 'draft' && !this.managesAll(actor)) {
      throw AppException.forbidden('observation.alreadySubmitted');
    }
    this.assertMayWrite(sheet, actor);

    sheet.deletedAt = new Date();
    sheet.deletedBy = new Types.ObjectId(actor.sub);
    await sheet.save();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'delete',
      entityType: 'TeachingObservation',
      entityId: sheet._id,
      oldValue: { status: sheet.status, totalScore: sheet.totalScore },
      ip,
    });
  }

  // ── Access ────────────────────────────────────────────────────────────────

  /** `manage` is the academic office: it sees and corrects the whole school's. */
  private managesAll(actor: AuthenticatedUser): boolean {
    return actor.permissions.some(
      (permission) =>
        permission.resource === 'teaching-observations' && permission.actions.includes('manage'),
    );
  }

  /**
   * Narrows a list to the sheets this actor may see.
   *
   * Without it, the `read` grant a teacher needs in order to see their own
   * observations would hand them every judgement written about every colleague
   * on the staff. A teacher sees the sheets they wrote and the sheets written
   * about them — nothing else, and anyone who is neither sees nothing at all.
   */
  private applyVisibility(
    filter: FilterQuery<TeachingObservationDocument>,
    actor: AuthenticatedUser,
  ): void {
    if (this.managesAll(actor)) return;

    if (actor.personType !== 'teacher' || !actor.personId) {
      filter._id = { $in: [] };
      return;
    }

    const own = new Types.ObjectId(actor.personId);
    // `$and`, not a bare `$or`: the caller may already have filtered by
    // `teacherId`, and a second top-level `$or` would replace rather than narrow
    // it — handing a teacher somebody else's sheets through a query parameter.
    filter.$and = [
      ...((filter.$and as object[]) ?? []),
      { $or: [{ teacherId: own }, { observerId: own }] },
    ];
  }

  private assertMayRead(sheet: TeachingObservationDocument, actor: AuthenticatedUser): void {
    if (this.managesAll(actor)) return;
    if (actor.personType !== 'teacher' || !actor.personId) throw AppException.forbidden();

    const own = new Types.ObjectId(actor.personId);
    const observed = refEquals(sheet.teacherId, own);
    const observer = refEquals(sheet.observerId, own);
    if (!observed && !observer) throw AppException.forbidden();

    // A draft is the observer's working copy; the teacher it is about only sees
    // it once it has been filed.
    if (sheet.status === 'draft' && !observer) throw AppException.forbidden();
  }

  private assertMayWrite(sheet: TeachingObservationDocument, actor: AuthenticatedUser): void {
    if (this.managesAll(actor)) return;
    if (actor.personType !== 'teacher' || !actor.personId) throw AppException.forbidden();
    if (!refEquals(sheet.observerId, new Types.ObjectId(actor.personId))) {
      throw AppException.forbidden('observation.notTheObserver');
    }
  }

  /**
   * Who the sheet says did the observing.
   *
   * Defaults to the signed-in teacher, which is the ordinary case and the one
   * that must not depend on remembering to fill a field in. Naming somebody else
   * is the office keying in a paper sheet, so it needs `manage` — otherwise a
   * teacher could file a judgement about a colleague under a third person's name.
   */
  private async resolveObserver(
    observerId: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<Types.ObjectId> {
    const ownTeacherId = actor.personType === 'teacher' && actor.personId ? actor.personId : null;

    if (!observerId) {
      if (!ownTeacherId) throw AppException.badRequest('observation.observerRequired');
      return new Types.ObjectId(ownTeacherId);
    }

    if (observerId !== ownTeacherId && !this.managesAll(actor)) {
      throw AppException.forbidden('observation.notTheObserver');
    }

    const observer = await this.teacherModel
      .findOne({ _id: observerId, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (!observer) throw AppException.notFound('common.notFound', { field: 'observerId' });

    return observer._id;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async resolveSemester(semesterId?: string): Promise<SemesterDocument> {
    const semester = semesterId
      ? await this.semesterModel.findOne({ _id: semesterId, deletedAt: null }).exec()
      : await this.semesterModel.findOne({ isActive: true, deletedAt: null }).exec();

    if (!semester) {
      throw AppException.notFound('common.notFound', {
        field: 'semesterId',
        reason: semesterId ? undefined : 'no active semester — name one explicitly',
      });
    }
    return semester;
  }

  /**
   * ປະເມີນຄັ້ງທີ — one past the highest already in this scope.
   *
   * `exclude` is the sheet being renumbered, when a draft is moved: it must not
   * count itself into the run it is joining.
   */
  private async nextVisitNumber(scope: VisitScope, exclude?: Types.ObjectId): Promise<number> {
    const filter: FilterQuery<TeachingObservationDocument> = { ...scope, deletedAt: null };
    if (exclude) filter._id = { $ne: exclude };

    const latest = await this.model
      .findOne(filter)
      .select('visitNumber')
      .sort({ visitNumber: -1 })
      .lean()
      .exec();

    return (latest?.visitNumber ?? 0) + 1;
  }

  /**
   * Turns the unique index into something a user can act on.
   *
   * Two observers filing the same teacher's visit at the same moment is a real
   * race, not a bug — the loser is told which number was taken and files again.
   */
  private asDuplicateVisit(error: unknown, visitNumber: number): unknown {
    const code = (error as { code?: number })?.code;
    if (code === 11000) {
      return AppException.conflict('observation.duplicateVisit', { visitNumber });
    }
    return error;
  }
}

/**
 * A scope as one comparable string.
 *
 * `String(...)` per field rather than `===` on the ids: these are ObjectIds on a
 * hydrated document and plain values elsewhere, and comparing them by identity
 * is the mistake this codebase keeps having to unmake.
 */
function visitScopeKey(sheet: TeachingObservationDocument): string {
  return [sheet.teacherId, sheet.observerId, sheet.subjectId, sheet.semesterId]
    .map((id) => String(id))
    .join('|');
}

/** The mean, to one decimal; `null` for an empty set rather than a misleading 0. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/** Compares a possibly-populated reference against an id. */
function refEquals(ref: Types.ObjectId | { _id: Types.ObjectId }, id: Types.ObjectId): boolean {
  const value = (ref as { _id?: Types.ObjectId })?._id ?? (ref as Types.ObjectId);
  return String(value) === String(id);
}

/**
 * A `yyyy-MM-dd` day at UTC midnight.
 *
 * Visits are counted by day, never by hour: two sheets written on the same
 * afternoon must compare equal, and a school in ICT storing local noon would
 * otherwise file an evening entry under the following day.
 */
export function toUtcMidnight(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
