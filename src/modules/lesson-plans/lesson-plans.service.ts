import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LessonPlanStatus } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  Attachment,
  LessonPlan,
  LessonPlanDocument,
  Semester,
  SemesterDocument,
  Subject,
  SubjectDocument,
  SubjectGroup,
  SubjectGroupDocument,
  Teacher,
  TeacherDocument,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateLessonPlanDto,
  MarkActivityCompletedDto,
  QueryComplianceDto,
  QueryLessonPlansDto,
  ReviewLessonPlanDto,
  UpdateLessonPlanDto,
} from './dto/lesson-plan.dto';
import {
  assembleMatrix,
  ComplianceMatrix,
  ExpectedRow,
  GroupMeta,
  PlanFacts,
  planKey,
} from './lesson-plan-compliance';
import {
  buildSemesterWeeks,
  DEFAULT_LESSON_PLAN_POLICY,
  deriveDueDate,
  endOfWeek,
  LessonPlanPolicy,
  SemesterWeek,
  startOfWeek,
} from './lesson-plan-weeks';

/**
 * Allowed status transitions.
 *
 * `returned` goes back to `submitted`, which is the whole point of the workflow:
 * a returned plan is revised and resubmitted, not recreated.
 */
const ALLOWED_TRANSITIONS: Record<LessonPlanStatus, LessonPlanStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'approved', 'returned'],
  under_review: ['approved', 'returned'],
  returned: ['submitted'],
  // Terminal: an approved plan is a record of what was agreed.
  approved: [],
};

/** How far ahead a plan counts as "due soon" for the reminder sweep. */
export const DUE_SOON_HOURS = 48;

/** Setting that holds the deadline policy; absent means the built-in default. */
const POLICY_SETTING_KEY = 'lessonPlans.submissionPolicy';

/** Just enough of a teacher to name them on the matrix. */
const TEACHER_NAME_FIELDS = 'teacherCode firstNameLo lastNameLo subjectGroupId';

@Injectable()
export class LessonPlansService {
  private readonly logger = new Logger(LessonPlansService.name);

  constructor(
    @InjectModel(LessonPlan.name) private readonly model: Model<LessonPlanDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(SubjectGroup.name)
    private readonly subjectGroupModel: Model<SubjectGroupDocument>,
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignmentDocument>,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(query: QueryLessonPlansDto): Promise<PaginatedResponse<LessonPlanDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.status) filter.status = query.status;
    if (query.isLate !== undefined) filter.isLate = query.isLate === 'true';
    if (query.weekStartDate) filter.weekStartDate = startOfWeek(query.weekStartDate);

    // A department is a property of the subject, not of the plan, so filtering by
    // it means resolving the subjects first. Kept as a two-step read rather than
    // an aggregation: the subject list is small and bounded by the curriculum.
    if (query.subjectGroupId) {
      const subjectIds = await this.subjectModel
        .find({ subjectGroupId: new Types.ObjectId(query.subjectGroupId), deletedAt: null })
        .select('_id')
        .lean()
        .exec();
      filter.subjectId = { $in: subjectIds.map((subject) => subject._id) };
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('subjectId', 'code nameLo')
        .populate('classroomId', 'name')
        .populate('teacherId', 'teacherCode firstNameLo lastNameLo')
        .sort({ dueDate: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<LessonPlanDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const plan = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('subjectId', 'code nameLo')
      .populate('classroomId', 'name')
      .populate('teacherId', 'teacherCode firstNameLo lastNameLo')
      .exec();
    if (!plan) throw AppException.notFound();
    return plan;
  }

  /**
   * Who owes a plan, and for which week.
   *
   * This is the one read that can report a plan that was never written. It starts
   * from the timetable — every (teacher, subject, class) with an active
   * assignment — crosses it with the semester's weeks, and fills in the plans
   * that exist. Every remaining cell is a gap, which is precisely what the plain
   * list endpoint cannot show.
   *
   * Future weeks are excluded by default: a term's remaining weeks are not
   * missing work, and showing them as gaps would drown the ones that are.
   */
  async findCompliance(query: QueryComplianceDto): Promise<ComplianceMatrix> {
    const semester = await this.resolveSemester(query.semesterId);
    const weeks = this.selectWeeks(semester, query);

    if (weeks.length === 0) {
      return assembleMatrix({
        semester: this.semesterMeta(semester),
        weeks,
        rows: [],
        groups: [],
        plansByKey: new Map(),
        policy: await this.getPolicy(),
        now: new Date(),
      });
    }

    const [rows, groups, plansByKey, policy] = await Promise.all([
      this.loadExpectedRows(semester._id, query),
      this.loadGroupMeta(),
      this.loadPlanFacts(semester._id, weeks),
      this.getPolicy(),
    ]);

    return assembleMatrix({
      semester: this.semesterMeta(semester),
      weeks,
      rows,
      groups,
      plansByKey,
      policy,
      now: new Date(),
    });
  }

  /** The review queue: submitted plans, oldest deadline first. */
  async findReviewQueue(query: QueryLessonPlansDto) {
    // Mutate the DTO instance rather than spreading it — a spread produces a
    // plain object and loses `skip`/`toSort`, which are getters on the class.
    query.status = query.status ?? 'submitted';
    return this.findAll(query);
  }

  /**
   * Creates a plan as a draft.
   *
   * The teacher is taken from the caller's own identity, never from the request
   * body — otherwise any teacher could file a plan in a colleague's name. The
   * week is snapped to its Monday and the deadline derived from school policy, so
   * the plan lands on exactly the cell the compliance matrix is looking for.
   */
  async create(
    dto: CreateLessonPlanDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<LessonPlanDocument> {
    const teacherId = await this.resolveTeacherId(actor);

    // A plan for a lesson the caller is not timetabled to teach would never
    // appear on the matrix — there is no row for it — so it is rejected rather
    // than filed somewhere nobody looks.
    await this.assertIsTimetabled(teacherId, dto);

    const weekStartDate = startOfWeek(dto.weekStartDate);
    const policy = await this.getPolicy();

    const created = await this.model.create({
      teacherId,
      subjectId: new Types.ObjectId(dto.subjectId),
      classroomId: new Types.ObjectId(dto.classroomId),
      semesterId: new Types.ObjectId(dto.semesterId),
      title: dto.title,
      description: dto.description ?? null,
      weekStartDate,
      weekEndDate: endOfWeek(weekStartDate),
      dueDate: deriveDueDate(weekStartDate, policy),
      activities: (dto.activities ?? []).map((activity) => ({
        ...activity,
        date: new Date(activity.date),
        materials: activity.materials ?? [],
      })),
      status: 'draft',
    });

    await this.audit.record({
      action: 'create',
      entityType: 'lessonPlans',
      entityId: created._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { title: created.title, dueDate: created.dueDate },
      ip,
    });

    return created;
  }

  /** Edits are allowed only while the plan is the teacher's to change. */
  async update(
    id: string,
    dto: UpdateLessonPlanDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<LessonPlanDocument> {
    const plan = await this.findOne(id);
    await this.assertIsOwner(plan, actor);

    // An approved plan is the agreed record; a submitted one is in someone
    // else's hands. Both must be reopened before editing.
    if (plan.status === 'approved' || plan.status === 'under_review') {
      throw AppException.conflict('common.validationFailed', {
        reason: `a plan in status "${plan.status}" cannot be edited`,
      });
    }

    const patch: Record<string, unknown> = { ...dto };

    // Moving the week moves everything derived from it. Re-deriving the deadline
    // here is deliberate and safe: an unsubmitted plan has no recorded lateness
    // to invalidate, and `submit` is what freezes `isLate`.
    if (dto.weekStartDate) {
      const weekStartDate = startOfWeek(dto.weekStartDate);
      patch.weekStartDate = weekStartDate;
      patch.weekEndDate = endOfWeek(weekStartDate);
      patch.dueDate = deriveDueDate(weekStartDate, await this.getPolicy());
    }

    if (dto.activities) {
      patch.activities = dto.activities.map((activity) => ({
        ...activity,
        date: new Date(activity.date),
        materials: activity.materials ?? [],
      }));
    }

    const updated = await this.model
      .findOneAndUpdate({ _id: id }, patch, { new: true, runValidators: true })
      .exec();
    if (!updated) throw AppException.notFound();

    await this.audit.record({
      action: 'update',
      entityType: 'lessonPlans',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { title: updated.title },
      ip,
    });

    return updated;
  }

  /**
   * Submits a plan for review.
   *
   * `isLate` is derived here rather than trusted from input, and it is derived
   * once — at the moment of submission — so a later deadline change cannot
   * retroactively make a late plan punctual.
   */
  async submit(
    id: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<LessonPlanDocument> {
    const plan = await this.findOne(id);
    await this.assertIsOwner(plan, actor);
    this.assertTransition(plan.status, 'submitted');

    // Either form of the deliverable counts. The detailed form composes sessions
    // in the app; the monthly checklist takes the plan as a document, and on that
    // path the file *is* the plan — so demanding a session as well would reject
    // exactly the submission the checklist exists to collect.
    if (plan.activities.length === 0 && plan.attachments.length === 0) {
      throw AppException.badRequest('common.validationFailed', {
        reason:
          'a plan needs at least one activity or an attached document before it can be submitted',
      });
    }

    const submittedAt = new Date();
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            status: 'submitted',
            submittedAt,
            isLate: submittedAt > plan.dueDate,
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw AppException.notFound();

    await this.notifyAcademicHeads(updated);

    await this.audit.record({
      action: 'update',
      entityType: 'lessonPlans',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: plan.status },
      newValue: { status: 'submitted', isLate: updated.isLate },
      ip,
      reason: updated.isLate ? 'submitted after the deadline' : null,
    });

    return updated;
  }

  /**
   * Approves or returns a plan.
   *
   * A return must carry a comment: sending work back without saying why is not a
   * review, and the teacher has no way to act on it.
   */
  async review(
    id: string,
    dto: ReviewLessonPlanDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<LessonPlanDocument> {
    const plan = await this.findOne(id);
    this.assertTransition(plan.status, dto.decision === 'approved' ? 'approved' : 'returned');

    if (dto.decision === 'returned' && !dto.comment?.trim()) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'comment',
        reason: 'a comment is required when returning a plan',
      });
    }

    const reviewedAt = new Date();
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id },
        {
          $set: { status: dto.decision, lastReviewedAt: reviewedAt },
          $push: {
            reviews: {
              reviewerId: new Types.ObjectId(actor.sub),
              reviewerName: actor.username,
              decision: dto.decision,
              comment: dto.comment ?? null,
              reviewedAt,
            },
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw AppException.notFound();

    await this.notifyTeacherOfReview(updated, dto);

    await this.audit.record({
      action: dto.decision === 'approved' ? 'approve' : 'reject',
      entityType: 'lessonPlans',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: plan.status },
      newValue: { status: dto.decision },
      ip,
      reason: dto.comment ?? null,
    });

    return updated;
  }

  /** Records that a planned session was actually taught. */
  async markActivity(
    id: string,
    dto: MarkActivityCompletedDto,
    actor: AuthenticatedUser,
  ): Promise<LessonPlanDocument> {
    const plan = await this.findOne(id);
    await this.assertIsOwner(plan, actor);

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, 'activities._id': new Types.ObjectId(dto.activityId) },
        {
          $set: {
            'activities.$.isCompleted': dto.isCompleted,
            ...(dto.reflection !== undefined ? { 'activities.$.reflection': dto.reflection } : {}),
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw AppException.notFound('common.notFound', { field: 'activityId' });
    }
    return updated;
  }

  async addAttachment(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    actor: AuthenticatedUser,
  ): Promise<LessonPlanDocument> {
    const plan = await this.findOne(id);
    await this.assertIsOwner(plan, actor);

    const uploaded = await this.storage.upload(file, 'document', `lesson-plans/${id}`);
    const attachment: Attachment = {
      key: uploaded.key,
      filename: uploaded.filename,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      uploadedAt: new Date(),
    };

    const updated = await this.model
      .findOneAndUpdate({ _id: id }, { $push: { attachments: attachment } }, { new: true })
      .exec();
    if (!updated) throw AppException.notFound();
    return updated;
  }

  /** Signed URLs for the attachments, minted on read. */
  async getAttachmentUrls(id: string): Promise<{ filename: string; url: string | null }[]> {
    const plan = await this.findOne(id);
    return Promise.all(
      plan.attachments.map(async (attachment) => ({
        filename: attachment.filename,
        url: await this.storage.getSignedUrl(attachment.key),
      })),
    );
  }

  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const plan = await this.findOne(id);
    await this.assertIsOwner(plan, actor);

    if (plan.status === 'approved') {
      throw AppException.conflict('common.validationFailed', {
        reason: 'an approved plan is part of the academic record and cannot be deleted',
      });
    }

    plan.deletedAt = new Date();
    plan.deletedBy = new Types.ObjectId(actor.sub);
    await plan.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'lessonPlans',
      entityId: plan._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { title: plan.title, status: plan.status },
      ip,
    });
  }

  // ── Reminder sweep ────────────────────────────────────────────────────────

  /**
   * Notifies teachers about plans that are nearly due or already overdue.
   *
   * Idempotency is intentionally *not* tracked per plan: the sweep is scheduled
   * to run once a day, so a plan due soon produces one reminder per day, which
   * is the desired behaviour rather than a bug. Running it twice by hand would
   * double-notify — acceptable for a reminder.
   */
  async runDueReminders(): Promise<{ dueSoon: number; overdue: number }> {
    const now = new Date();
    const soonThreshold = new Date(now.getTime() + DUE_SOON_HOURS * 60 * 60 * 1000);

    const pending: LessonPlanStatus[] = ['draft', 'returned'];

    const [dueSoon, overdue] = await Promise.all([
      this.model
        .find({
          status: { $in: pending },
          dueDate: { $gt: now, $lte: soonThreshold },
          deletedAt: null,
        })
        .exec(),
      this.model.find({ status: { $in: pending }, dueDate: { $lt: now }, deletedAt: null }).exec(),
    ]);

    for (const plan of dueSoon) {
      await this.notifyTeacherOfDeadline(plan, 'due_soon');
    }
    for (const plan of overdue) {
      await this.notifyTeacherOfDeadline(plan, 'overdue');
    }

    this.logger.log(`Lesson-plan reminders: ${dueSoon.length} due soon, ${overdue.length} overdue`);
    return { dueSoon: dueSoon.length, overdue: overdue.length };
  }

  // ── Compliance internals ──────────────────────────────────────────────────

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

  private semesterMeta(semester: SemesterDocument) {
    return {
      id: semester._id.toString(),
      nameLo: semester.nameLo,
      nameEn: semester.nameEn ?? null,
      startDate: semester.startDate,
      endDate: semester.endDate,
    };
  }

  /**
   * The weeks to show.
   *
   * Bounded at the current week unless the caller asks for more, because a plan
   * for a week that has not arrived is not late — it is not yet due.
   */
  private selectWeeks(semester: SemesterDocument, query: QueryComplianceDto): SemesterWeek[] {
    const all = buildSemesterWeeks(semester.startDate, semester.endDate);

    const from = query.fromWeek ? startOfWeek(query.fromWeek) : startOfWeek(semester.startDate);
    const to = query.toWeek ? startOfWeek(query.toWeek) : startOfWeek(new Date());

    return all.filter((week) => week.startDate >= from && week.startDate <= to);
  }

  /**
   * The rows the timetable says should exist.
   *
   * `subjectGroupId` lives on the subject, so the department filter is applied
   * after populating rather than in the query — the alternative is an aggregation
   * pipeline for a collection with one row per teacher per class per subject.
   */
  private async loadExpectedRows(
    semesterId: Types.ObjectId,
    query: QueryComplianceDto,
  ): Promise<ExpectedRow[]> {
    const filter: Record<string, unknown> = {
      semesterId,
      isActive: true,
      deletedAt: null,
    };
    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);

    const assignments = await this.assignmentModel
      .find(filter)
      .populate('teacherId', TEACHER_NAME_FIELDS)
      .populate('subjectId', 'code nameLo nameEn subjectGroupId')
      .populate({
        path: 'classroomId',
        select: 'name gradeLevelId',
        populate: { path: 'gradeLevelId', select: 'code' },
      })
      .lean()
      .exec();

    const rows: ExpectedRow[] = [];

    for (const assignment of assignments) {
      const teacher = assignment.teacherId as unknown as {
        _id: Types.ObjectId;
        teacherCode: string;
        firstNameLo: string;
        lastNameLo: string;
      } | null;
      const subject = assignment.subjectId as unknown as {
        _id: Types.ObjectId;
        code: string;
        nameLo: string;
        nameEn?: string | null;
        subjectGroupId?: Types.ObjectId | null;
      } | null;
      const classroom = assignment.classroomId as unknown as {
        _id: Types.ObjectId;
        name: string;
        gradeLevelId?: { code?: string } | null;
      } | null;

      // A soft-deleted teacher, subject or class leaves the populate null. The
      // assignment is then unattributable, so it is dropped rather than shown as
      // a row nobody owns.
      if (!teacher || !subject || !classroom) continue;

      const subjectGroupId = subject.subjectGroupId ? subject.subjectGroupId.toString() : null;
      if (query.subjectGroupId && subjectGroupId !== query.subjectGroupId) continue;

      rows.push({
        teachingAssignmentId: assignment._id.toString(),
        teacherId: teacher._id.toString(),
        teacherCode: teacher.teacherCode,
        teacherName: `${teacher.firstNameLo} ${teacher.lastNameLo}`,
        subjectId: subject._id.toString(),
        subjectCode: subject.code,
        subjectNameLo: subject.nameLo,
        subjectNameEn: subject.nameEn ?? null,
        classroomId: classroom._id.toString(),
        classroomName: classroom.gradeLevelId?.code
          ? `${classroom.gradeLevelId.code}/${classroom.name}`
          : classroom.name,
        subjectGroupId,
      });
    }

    return rows;
  }

  private async loadGroupMeta(): Promise<GroupMeta[]> {
    const groups = await this.subjectGroupModel
      .find({ deletedAt: null })
      .sort({ sortOrder: 1 })
      .populate('headTeacherId', 'firstNameLo lastNameLo')
      .lean()
      .exec();

    return groups.map((group) => {
      const head = group.headTeacherId as unknown as {
        firstNameLo: string;
        lastNameLo: string;
      } | null;
      return {
        id: group._id.toString(),
        code: group.code,
        nameLo: group.nameLo,
        nameEn: group.nameEn ?? null,
        headTeacherName: head ? `${head.firstNameLo} ${head.lastNameLo}` : null,
      };
    });
  }

  /**
   * The semester's plans, keyed for O(1) cell lookup.
   *
   * Read whole rather than per cell: a term is ~20 weeks and a school this size
   * has a few hundred plans, so one query beats hundreds of them.
   */
  private async loadPlanFacts(
    semesterId: Types.ObjectId,
    weeks: SemesterWeek[],
  ): Promise<Map<string, PlanFacts>> {
    const plans = await this.model
      .find({
        semesterId,
        weekStartDate: {
          $gte: weeks[0].startDate,
          $lte: weeks[weeks.length - 1].startDate,
        },
        deletedAt: null,
      })
      .select(
        'teacherId subjectId classroomId weekStartDate status isLate submittedAt attachments activities',
      )
      .lean()
      .exec();

    const byKey = new Map<string, PlanFacts>();

    for (const plan of plans) {
      const key = planKey(
        plan.teacherId.toString(),
        plan.subjectId.toString(),
        plan.classroomId.toString(),
        plan.weekStartDate,
      );
      byKey.set(key, {
        id: plan._id.toString(),
        status: plan.status,
        isLate: plan.isLate,
        submittedAt: plan.submittedAt ?? null,
        attachmentCount: plan.attachments?.length ?? 0,
        activityCount: plan.activities?.length ?? 0,
        completedActivityCount:
          plan.activities?.filter((activity) => activity.isCompleted).length ?? 0,
      });
    }

    return byKey;
  }

  /** The deadline policy, falling back to the built-in default when unset. */
  /** Public so the monthly checklist derives its deadlines from the same rule. */
  async getPolicy(): Promise<LessonPlanPolicy> {
    const stored = await this.settings.getValue<Partial<LessonPlanPolicy>>(POLICY_SETTING_KEY);
    return { ...DEFAULT_LESSON_PLAN_POLICY, ...(stored ?? {}) };
  }

  /**
   * Rejects a plan for a lesson the teacher does not have on the timetable.
   *
   * The compliance matrix takes its rows from `TeachingAssignment`, so a plan
   * with no matching assignment has no cell to land in — it would be filed and
   * then invisible to the very oversight it exists for.
   */
  private async assertIsTimetabled(
    teacherId: Types.ObjectId,
    dto: CreateLessonPlanDto,
  ): Promise<void> {
    const exists = await this.assignmentModel
      .exists({
        teacherId,
        subjectId: new Types.ObjectId(dto.subjectId),
        classroomId: new Types.ObjectId(dto.classroomId),
        semesterId: new Types.ObjectId(dto.semesterId),
        deletedAt: null,
      })
      .lean()
      .exec();

    if (!exists) {
      throw AppException.badRequest('common.validationFailed', {
        reason:
          'no teaching assignment for this subject and class in the semester — a plan can ' +
          'only be filed against a lesson on the timetable',
      });
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private assertTransition(from: LessonPlanStatus, to: LessonPlanStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw AppException.badRequest('common.validationFailed', {
        reason: `cannot move a lesson plan from "${from}" to "${to}"`,
        allowed,
      });
    }
  }

  /**
   * A teacher may only act on their own plans; `lesson-plans:approve` (the
   * academic head) may act on any.
   */
  private async assertIsOwner(plan: LessonPlanDocument, actor: AuthenticatedUser): Promise<void> {
    const canApproveAny = actor.permissions.some(
      (p) =>
        p.resource === 'lesson-plans' &&
        (p.actions.includes('approve') || p.actions.includes('manage')),
    );
    if (canApproveAny) return;

    if (actor.personType !== 'teacher' || !actor.personId) throw AppException.forbidden();

    const ownerId = this.plainId(plan.teacherId);
    if (ownerId !== actor.personId) throw AppException.forbidden();
  }

  private async resolveTeacherId(actor: AuthenticatedUser): Promise<Types.ObjectId> {
    if (actor.personType !== 'teacher' || !actor.personId) {
      throw AppException.forbidden('auth.forbidden', {
        reason: 'only a teacher account can create a lesson plan',
      });
    }
    const teacher = await this.teacherModel
      .findOne({ _id: actor.personId, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (!teacher) throw AppException.notFound('common.notFound', { field: 'teacherId' });
    return teacher._id;
  }

  private async notifyAcademicHeads(plan: LessonPlanDocument): Promise<void> {
    const heads = await this.resolveReviewers(plan);

    const userIds = (
      await Promise.all(
        heads.map((headId) => this.notifications.findUserIdForPerson('teacher', headId)),
      )
    ).filter((id): id is Types.ObjectId => id !== null);

    await this.notifications.notifyMany(userIds, {
      type: 'general',
      titleLo: 'ມີແຜນການສອນລໍຖ້າກວດ',
      titleEn: 'Lesson plan awaiting review',
      bodyLo: `"${plan.title}" ຖືກສົ່ງມາເພື່ອກວດສອບ${plan.isLate ? ' (ສົ່ງຊ້າ)' : ''}`,
      bodyEn: `"${plan.title}" has been submitted for review${plan.isLate ? ' (late)' : ''}`,
      data: { entityType: 'lessonPlans', entityId: plan._id.toString() },
    });
  }

  /**
   * Who should look at this plan.
   *
   * The head of the subject's own department, when there is one. Before subject
   * groups existed this had to be every `isAcademicHead` teacher in the school,
   * which is why a maths submission pinged the head of languages — that fallback
   * is kept only for a subject with no group, or a group with no head, where
   * notifying nobody would be worse than notifying too many.
   */
  private async resolveReviewers(plan: LessonPlanDocument): Promise<Types.ObjectId[]> {
    const subject = await this.subjectModel
      .findOne({ _id: this.plainId(plan.subjectId), deletedAt: null })
      .select('subjectGroupId')
      .lean()
      .exec();

    if (subject?.subjectGroupId) {
      const group = await this.subjectGroupModel
        .findOne({ _id: subject.subjectGroupId, deletedAt: null })
        .select('headTeacherId')
        .lean()
        .exec();

      if (group?.headTeacherId) {
        // Confirmed active: a resigned head still on the group would silently
        // swallow every submission for that department.
        const head = await this.teacherModel
          .exists({ _id: group.headTeacherId, status: 'active', deletedAt: null })
          .lean()
          .exec();
        if (head) return [group.headTeacherId];
      }
    }

    const heads = await this.teacherModel
      .find({ isAcademicHead: true, status: 'active', deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return heads.map((head) => head._id);
  }

  private async notifyTeacherOfReview(
    plan: LessonPlanDocument,
    dto: ReviewLessonPlanDto,
  ): Promise<void> {
    const userId = await this.notifications.findUserIdForPerson(
      'teacher',
      this.plainId(plan.teacherId),
    );
    if (!userId) return;

    const approved = dto.decision === 'approved';
    await this.notifications.notify({
      userId,
      type: approved ? 'general' : 'lesson_plan_returned',
      titleLo: approved ? 'ແຜນການສອນຖືກອະນຸມັດ' : 'ແຜນການສອນຖືກຕີກັບ',
      titleEn: approved ? 'Lesson plan approved' : 'Lesson plan returned',
      bodyLo: approved
        ? `"${plan.title}" ຖືກອະນຸມັດແລ້ວ`
        : `"${plan.title}" ຖືກຕີກັບ: ${dto.comment ?? ''}`,
      bodyEn: approved
        ? `"${plan.title}" has been approved.`
        : `"${plan.title}" was returned: ${dto.comment ?? ''}`,
      data: { entityType: 'lessonPlans', entityId: plan._id.toString() },
    });
  }

  private async notifyTeacherOfDeadline(
    plan: LessonPlanDocument,
    kind: 'due_soon' | 'overdue',
  ): Promise<void> {
    const userId = await this.notifications.findUserIdForPerson(
      'teacher',
      this.plainId(plan.teacherId),
    );
    if (!userId) return;

    const dueDate = plan.dueDate.toISOString().slice(0, 10);
    await this.notifications.notify({
      userId,
      type: 'lesson_plan_due',
      titleLo: kind === 'overdue' ? 'ແຜນການສອນເກີນກຳນົດ' : 'ແຜນການສອນໃກ້ຄົບກຳນົດ',
      titleEn: kind === 'overdue' ? 'Lesson plan overdue' : 'Lesson plan due soon',
      bodyLo:
        kind === 'overdue'
          ? `"${plan.title}" ເກີນກຳນົດສົ່ງແລ້ວ (${dueDate})`
          : `"${plan.title}" ຕ້ອງສົ່ງກ່ອນ ${dueDate}`,
      bodyEn:
        kind === 'overdue'
          ? `"${plan.title}" passed its deadline (${dueDate}).`
          : `"${plan.title}" is due by ${dueDate}.`,
      data: { entityType: 'lessonPlans', entityId: plan._id.toString(), kind },
    });
  }

  /** Works whether the ref is populated or a bare ObjectId. */
  private plainId(value: unknown): string {
    const candidate = value as { _id?: unknown };
    return String(candidate?._id ?? value);
  }
}
