import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  Classroom,
  ClassroomDocument,
  LessonPlan,
  LessonPlanDocument,
  LessonPlanMonth,
  LessonPlanMonthDocument,
  LessonPlanTask,
  LessonPlanTaskDocument,
  Semester,
  SemesterDocument,
  Subject,
  SubjectDocument,
  Teacher,
  TeacherDocument,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DraftLessonPlanMonthDto,
  QueryLessonPlanMonthsDto,
  QueryLessonPlanTasksDto,
} from './dto/lesson-plan-task.dto';
import { LessonPlansService } from './lesson-plans.service';
import { buildSemesterWeeks, deriveDueDate } from './lesson-plan-weeks';

/** A checklist line, with the state of whatever was handed in against it. */
export interface TaskRow {
  id: string;
  weekIndex: number;
  weekStartDate: string;
  weekEndDate: string;
  dueDate: string;
  teacherId: string;
  teacherCode: string;
  teacherName: string;
  subjectId: string;
  subjectCode: string;
  subjectNameLo: string;
  subjectNameEn: string | null;
  classroomId: string;
  classroomName: string;
  subjectGroupId: string | null;
  /** `missing` is not a stored status — it is the absence of a plan. */
  status: LessonPlanDocument['status'] | 'missing';
  lessonPlanId: string | null;
  attachmentCount: number;
  isLate: boolean;
  /** Nothing handed in and the deadline has passed. */
  isOverdue: boolean;
  submittedAt: string | null;
}

export interface MonthChecklist {
  month: {
    id: string;
    year: number;
    month: number;
    status: 'draft' | 'published';
    publishedAt: string | null;
    note: string | null;
    semesterId: string;
    semesterNameLo: string;
    semesterNameEn: string | null;
  };
  weeks: { index: number; startDate: string; endDate: string }[];
  tasks: TaskRow[];
  summary: {
    total: number;
    /** Reached the reviewer: submitted, under review, returned or approved. */
    submitted: number;
    approved: number;
    /** Nothing reached the reviewer yet — includes a draft nobody can see. */
    outstanding: number;
    overdue: number;
    withFiles: number;
  };
}

/** What a teacher's own row of the list needs, without the whole school's. */
type Populated<T> = T & { _id: Types.ObjectId };

/**
 * The monthly lesson-plan checklist.
 *
 * The compliance matrix answers "who owes a plan for every week of the term",
 * derived and unarguable — which is also its limit: it counts exam weeks,
 * holidays and the week a teacher was on leave as shortfalls. This service is the
 * academic office's editable answer instead. A month is drafted from the
 * timetable, trimmed by hand, then published; from that point teachers see their
 * lines and can hand a file in against one, and the count means something.
 *
 * Handing in still produces an ordinary `LessonPlan` — the office's line is the
 * obligation, the plan is the answer to it — so review, lateness and the deadline
 * reminders all keep working untouched.
 */
@Injectable()
export class LessonPlanTasksService {
  constructor(
    @InjectModel(LessonPlanMonth.name)
    private readonly monthModel: Model<LessonPlanMonthDocument>,
    @InjectModel(LessonPlanTask.name)
    private readonly taskModel: Model<LessonPlanTaskDocument>,
    @InjectModel(LessonPlan.name) private readonly planModel: Model<LessonPlanDocument>,
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignmentDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    private readonly plans: LessonPlansService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  // ── The office's side ─────────────────────────────────────────────────────

  /**
   * Drafts a month from the timetable, or fills in what a draft is missing.
   *
   * Additive on purpose: it creates the lines that do not exist and never deletes
   * one. A month that has been trimmed and re-drafted would otherwise resurrect
   * the very weeks the office had just decided were not owed.
   */
  async draftMonth(
    dto: DraftLessonPlanMonthDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<MonthChecklist> {
    const semester = await this.resolveSemester(dto.semesterId);
    const weeks = this.weeksInMonth(semester, dto.year, dto.month);

    if (weeks.length === 0) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'month',
        reason: 'the semester teaches no weeks in that month',
      });
    }

    const month = await this.monthModel
      .findOneAndUpdate(
        { semesterId: semester._id, year: dto.year, month: dto.month, deletedAt: null },
        { $setOnInsert: { status: 'draft' } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    // A published month is an obligation teachers have already been told about.
    // Regenerating it wholesale would change what they were told; a single line
    // can still be dropped, which is audited on its own.
    if (month.status === 'published') {
      throw AppException.conflict('common.validationFailed', {
        reason: 'a published month cannot be redrafted — remove individual lines instead',
      });
    }

    const assignments = await this.loadAssignments(semester._id, dto.subjectGroupIds);
    const policy = await this.plans.getPolicy();

    const existing = new Set(
      (await this.taskModel.find({ monthId: month._id, deletedAt: null }).lean().exec()).map(
        (task) => this.lineKey(task.teachingAssignmentId, task.weekStartDate),
      ),
    );

    const lines: Partial<LessonPlanTask>[] = [];
    for (const assignment of assignments) {
      for (const week of weeks) {
        if (existing.has(this.lineKey(assignment._id, week.startDate))) continue;
        lines.push({
          monthId: month._id,
          semesterId: semester._id,
          teachingAssignmentId: assignment._id,
          teacherId: assignment.teacherId,
          subjectId: assignment.subjectId,
          classroomId: assignment.classroomId,
          weekStartDate: week.startDate,
          weekEndDate: week.endDate,
          weekIndex: week.index,
          dueDate: deriveDueDate(week.startDate, policy),
        });
      }
    }

    if (lines.length > 0) await this.taskModel.insertMany(lines);

    await this.audit.record({
      action: 'create',
      entityType: 'lessonPlanMonths',
      entityId: month._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { year: dto.year, month: dto.month, linesAdded: lines.length },
      ip,
    });

    return this.checklist(month._id.toString(), actor);
  }

  async findMonths(query: QueryLessonPlanMonthsDto, actor: AuthenticatedUser) {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.year) filter.year = query.year;
    // A draft is the office's working copy. A teacher seeing one would be told to
    // hand in work against a list that is still being decided.
    if (!this.canManage(actor)) filter.status = 'published';

    const months = await this.monthModel
      .find(filter)
      .sort({ year: -1, month: -1 })
      .populate('semesterId', 'nameLo nameEn')
      .lean()
      .exec();

    return months.map((month) => {
      const semester = month.semesterId as unknown as Populated<{
        nameLo: string;
        nameEn?: string | null;
      }>;
      return {
        id: month._id.toString(),
        year: month.year,
        month: month.month,
        status: month.status,
        publishedAt: month.publishedAt ? month.publishedAt.toISOString() : null,
        note: month.note ?? null,
        semesterId: semester?._id?.toString() ?? '',
        semesterNameLo: semester?.nameLo ?? '',
        semesterNameEn: semester?.nameEn ?? null,
      };
    });
  }

  async setNote(
    id: string,
    note: string | undefined,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<MonthChecklist> {
    const month = await this.findMonthOrFail(id);
    month.note = note?.trim() ? note.trim() : null;
    await month.save();

    await this.audit.record({
      action: 'update',
      entityType: 'lessonPlanMonths',
      entityId: month._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { note: month.note },
      ip,
    });

    return this.checklist(id, actor);
  }

  /**
   * Publishes the month and tells each teacher their lines are waiting.
   *
   * One-way: teachers act on what they were told, and a list that can be pulled
   * back is one they cannot rely on.
   */
  async publish(id: string, actor: AuthenticatedUser, ip: string | null): Promise<MonthChecklist> {
    const month = await this.findMonthOrFail(id);
    if (month.status === 'published') {
      throw AppException.conflict('common.validationFailed', {
        reason: 'this month is already published',
      });
    }

    const tasks = await this.taskModel.find({ monthId: month._id, deletedAt: null }).lean().exec();
    if (tasks.length === 0) {
      throw AppException.badRequest('common.validationFailed', {
        reason: 'nothing to publish — the month has no lines',
      });
    }

    month.status = 'published';
    month.publishedAt = new Date();
    month.publishedBy = new Types.ObjectId(actor.sub);
    await month.save();

    await this.notifyTeachers(month, tasks);

    await this.audit.record({
      action: 'update',
      entityType: 'lessonPlanMonths',
      entityId: month._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: 'draft' },
      newValue: { status: 'published', lines: tasks.length },
      ip,
    });

    return this.checklist(id, actor);
  }

  /** Drops lines the office decided are not owed — an exam week, a holiday. */
  async removeTasks(
    id: string,
    taskIds: string[],
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<MonthChecklist> {
    const month = await this.findMonthOrFail(id);

    const ids = taskIds.map((taskId) => new Types.ObjectId(taskId));
    const tasks = await this.taskModel
      .find({ _id: { $in: ids }, monthId: month._id, deletedAt: null })
      .lean()
      .exec();

    // A line already answered is part of the record: dropping it would hide a
    // plan the teacher handed in and a reviewer may have approved.
    const answered = tasks.filter((task) => task.lessonPlanId);
    if (answered.length > 0) {
      throw AppException.conflict('common.validationFailed', {
        reason: `${answered.length} of these lines already have a plan handed in against them`,
      });
    }

    await this.taskModel
      .updateMany(
        { _id: { $in: tasks.map((task) => task._id) } },
        { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(actor.sub) } },
      )
      .exec();

    await this.audit.record({
      action: 'delete',
      entityType: 'lessonPlanTasks',
      entityId: month._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { removed: tasks.length },
      ip,
    });

    return this.checklist(id, actor);
  }

  async setTaskDueDate(
    taskId: string,
    dueDate: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<TaskRow> {
    const task = await this.findTaskOrFail(taskId);
    const previous = task.dueDate;
    task.dueDate = new Date(dueDate);
    await task.save();

    // The plan carries the deadline lateness is measured against, so moving the
    // line's deadline has to move the plan's too or the two would disagree.
    if (task.lessonPlanId) {
      await this.planModel
        .updateOne({ _id: task.lessonPlanId }, { $set: { dueDate: task.dueDate } })
        .exec();
    }

    await this.audit.record({
      action: 'update',
      entityType: 'lessonPlanTasks',
      entityId: task._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { dueDate: previous },
      newValue: { dueDate: task.dueDate },
      ip,
    });

    const [row] = await this.decorate([task.toObject() as unknown as LessonPlanTask]);
    return row;
  }

  // ── The checklist, as read by either side ─────────────────────────────────

  async checklist(
    id: string,
    actor: AuthenticatedUser,
    query: QueryLessonPlanTasksDto = {},
  ): Promise<MonthChecklist> {
    const month = await this.findMonthOrFail(id, { includeDrafts: this.canManage(actor) });
    const semester = await this.semesterModel.findById(month.semesterId).lean().exec();

    const filter: Record<string, unknown> = { monthId: month._id, deletedAt: null };
    // A teacher reads their own lines and nobody else's — the whole school's list
    // is the office's view, not theirs.
    const ownTeacherId = this.callerTeacherId(actor);
    if (ownTeacherId && !this.canManage(actor)) filter.teacherId = ownTeacherId;
    else if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);

    const tasks = await this.taskModel.find(filter).sort({ weekStartDate: 1 }).lean().exec();

    let rows = await this.decorate(tasks as unknown as LessonPlanTask[]);
    if (query.outstandingOnly) rows = rows.filter((row) => row.status === 'missing');

    const weeks = [
      ...new Map(
        rows.map((row) => [
          row.weekStartDate,
          { index: row.weekIndex, startDate: row.weekStartDate, endDate: row.weekEndDate },
        ]),
      ).values(),
    ].sort((a, b) => a.startDate.localeCompare(b.startDate));

    return {
      month: {
        id: month._id.toString(),
        year: month.year,
        month: month.month,
        status: month.status,
        publishedAt: month.publishedAt ? month.publishedAt.toISOString() : null,
        note: month.note ?? null,
        semesterId: month.semesterId.toString(),
        semesterNameLo: semester?.nameLo ?? '',
        semesterNameEn: semester?.nameEn ?? null,
      },
      weeks,
      tasks: rows,
      summary: this.summarize(rows),
    };
  }

  // ── The teacher's side ───────────────────────────────────────────────────

  /**
   * Hands a document in against a line.
   *
   * The file *is* the plan on this path — that is the point of the checklist — so
   * the plan record is created for the teacher rather than asked of them, the file
   * attached, and the whole thing submitted in one action. It goes through the
   * ordinary create/attach/submit calls so the review workflow, the lateness
   * calculation and the audit trail are the same ones the detailed form produces.
   */
  async uploadAgainstTask(
    taskId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<TaskRow> {
    const task = await this.findTaskOrFail(taskId);
    // Throws while the month is still a draft: a list the office has not published
    // is not one a teacher can hand work in against.
    await this.findMonthOrFail(task.monthId.toString(), { includeDrafts: false });

    const ownTeacherId = this.callerTeacherId(actor);
    if (!ownTeacherId || !task.teacherId.equals(ownTeacherId)) {
      throw AppException.forbidden('auth.forbidden', {
        reason: 'a lesson plan can only be handed in by the teacher it is owed by',
      });
    }

    const plan = await this.resolvePlanForTask(task, actor, ip);

    await this.plans.addAttachment(plan._id.toString(), file, actor);

    // A plan already with the reviewer stays there; a fresh or returned one goes
    // in now, which is what makes the line read as handed in.
    const current = await this.plans.findOne(plan._id.toString());
    if (current.status === 'draft' || current.status === 'returned') {
      await this.plans.submit(plan._id.toString(), actor, ip);
    }

    if (!task.lessonPlanId) {
      task.lessonPlanId = plan._id;
      await task.save();
    }

    const [row] = await this.decorate([task.toObject() as unknown as LessonPlanTask]);
    return row;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** The plan this line is answered by — reused if one already exists. */
  private async resolvePlanForTask(
    task: LessonPlanTaskDocument,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<LessonPlanDocument> {
    if (task.lessonPlanId) {
      const linked = await this.planModel
        .findOne({ _id: task.lessonPlanId, deletedAt: null })
        .exec();
      if (linked) return linked;
    }

    // The unique key a plan is filed under. A teacher who used the detailed form
    // first must not get a second plan for the same week from this path.
    const existing = await this.planModel
      .findOne({
        teacherId: task.teacherId,
        subjectId: task.subjectId,
        classroomId: task.classroomId,
        semesterId: task.semesterId,
        weekStartDate: task.weekStartDate,
        deletedAt: null,
      })
      .exec();
    if (existing) return existing;

    const created = await this.plans.create(
      {
        subjectId: task.subjectId.toString(),
        classroomId: task.classroomId.toString(),
        semesterId: task.semesterId.toString(),
        title: await this.defaultTitle(task),
        weekStartDate: task.weekStartDate.toISOString().slice(0, 10),
        activities: [],
      },
      actor,
      ip,
    );

    // The office's deadline wins over the standing policy the create path used —
    // lateness has to be measured against what the teacher was actually told.
    if (created.dueDate.getTime() !== task.dueDate.getTime()) {
      created.dueDate = task.dueDate;
      await created.save();
    }

    return created;
  }

  /** e.g. `ແຜນການສອນ ອາທິດທີ 3 (17/08–23/08)`. */
  private async defaultTitle(task: LessonPlanTaskDocument): Promise<string> {
    const subject = await this.subjectModel
      .findById(task.subjectId)
      .select('code nameLo')
      .lean()
      .exec();
    const span = `${format(task.weekStartDate)}–${format(task.weekEndDate)}`;
    const label = subject ? `${subject.nameLo} ` : '';
    return `${label}ອາທິດທີ ${task.weekIndex} (${span})`;
  }

  /**
   * Fills each line in with who owes it and what has been handed in.
   *
   * One query per collection rather than per line: a month is a few dozen lines
   * and the office reads the whole thing at once.
   */
  private async decorate(tasks: LessonPlanTask[]): Promise<TaskRow[]> {
    if (tasks.length === 0) return [];

    const ids = <T>(pick: (task: LessonPlanTask) => Types.ObjectId | null | undefined) =>
      [...new Set(tasks.map(pick).filter(Boolean) as Types.ObjectId[])] as T[];

    const [teachers, subjects, classrooms, plans] = await Promise.all([
      this.teacherModel
        .find({ _id: { $in: ids((task) => task.teacherId) } })
        .select('teacherCode firstNameLo lastNameLo')
        .lean()
        .exec(),
      this.subjectModel
        .find({ _id: { $in: ids((task) => task.subjectId) } })
        .select('code nameLo nameEn subjectGroupId')
        .lean()
        .exec(),
      this.classroomModel
        .find({ _id: { $in: ids((task) => task.classroomId) } })
        .select('name gradeLevelId')
        .populate('gradeLevelId', 'code')
        .lean()
        .exec(),
      // Matched on the plan's own unique key rather than on `lessonPlanId`, so a
      // plan filed through the detailed form still answers its line.
      this.planModel
        .find({
          teacherId: { $in: ids((task) => task.teacherId) },
          semesterId: { $in: ids((task) => task.semesterId) },
          weekStartDate: {
            $in: [...new Set(tasks.map((task) => task.weekStartDate.getTime()))].map(
              (time) => new Date(time),
            ),
          },
          deletedAt: null,
        })
        .select(
          'teacherId subjectId classroomId semesterId weekStartDate status attachments isLate submittedAt',
        )
        .lean()
        .exec(),
    ]);

    const byId = <T extends { _id: Types.ObjectId }>(rows: T[]) =>
      new Map(rows.map((row) => [row._id.toString(), row]));
    const teacherById = byId(teachers);
    const subjectById = byId(subjects);
    const classroomById = byId(classrooms);
    const planByKey = new Map(
      plans.map((plan) => [
        this.planKey(plan.teacherId, plan.subjectId, plan.classroomId, plan.weekStartDate),
        plan,
      ]),
    );

    const now = Date.now();

    return tasks.map((task) => {
      const teacher = teacherById.get(task.teacherId.toString());
      const subject = subjectById.get(task.subjectId.toString());
      const classroom = classroomById.get(task.classroomId.toString()) as
        { _id: Types.ObjectId; name: string; gradeLevelId?: { code?: string } | null } | undefined;
      const plan = planByKey.get(
        this.planKey(task.teacherId, task.subjectId, task.classroomId, task.weekStartDate),
      );

      return {
        id: (task as unknown as Populated<LessonPlanTask>)._id.toString(),
        weekIndex: task.weekIndex,
        weekStartDate: task.weekStartDate.toISOString().slice(0, 10),
        weekEndDate: task.weekEndDate.toISOString().slice(0, 10),
        dueDate: task.dueDate.toISOString(),
        teacherId: task.teacherId.toString(),
        teacherCode: teacher?.teacherCode ?? '',
        teacherName: teacher ? `${teacher.firstNameLo} ${teacher.lastNameLo}` : '',
        subjectId: task.subjectId.toString(),
        subjectCode: subject?.code ?? '',
        subjectNameLo: subject?.nameLo ?? '',
        subjectNameEn: subject?.nameEn ?? null,
        classroomId: task.classroomId.toString(),
        classroomName: classroom?.gradeLevelId?.code
          ? `${classroom.gradeLevelId.code}/${classroom.name}`
          : (classroom?.name ?? ''),
        subjectGroupId: subject?.subjectGroupId ? subject.subjectGroupId.toString() : null,
        status: plan?.status ?? 'missing',
        lessonPlanId: plan ? (plan._id as Types.ObjectId).toString() : null,
        attachmentCount: plan?.attachments?.length ?? 0,
        isLate: plan?.isLate ?? false,
        isOverdue: !plan && task.dueDate.getTime() < now,
        submittedAt: plan?.submittedAt ? new Date(plan.submittedAt).toISOString() : null,
      } satisfies TaskRow;
    });
  }

  private summarize(rows: TaskRow[]): MonthChecklist['summary'] {
    const reachedReviewer = (row: TaskRow) =>
      row.status === 'submitted' ||
      row.status === 'under_review' ||
      row.status === 'returned' ||
      row.status === 'approved';

    return {
      total: rows.length,
      submitted: rows.filter(reachedReviewer).length,
      approved: rows.filter((row) => row.status === 'approved').length,
      outstanding: rows.filter((row) => !reachedReviewer(row)).length,
      overdue: rows.filter((row) => row.isOverdue).length,
      withFiles: rows.filter((row) => row.attachmentCount > 0).length,
    };
  }

  /**
   * The semester's weeks that belong to a calendar month.
   *
   * A week straddling two months belongs to the one its Monday falls in — the
   * same Monday the plan itself is filed under, so a week is never owed twice.
   */
  private weeksInMonth(semester: SemesterDocument, year: number, month: number) {
    return buildSemesterWeeks(semester.startDate, semester.endDate).filter(
      (week) =>
        week.startDate.getUTCFullYear() === year && week.startDate.getUTCMonth() + 1 === month,
    );
  }

  private async loadAssignments(semesterId: Types.ObjectId, subjectGroupIds?: string[]) {
    const assignments = await this.assignmentModel
      .find({ semesterId, isActive: true, deletedAt: null })
      .select('teacherId subjectId classroomId')
      .lean()
      .exec();

    if (!subjectGroupIds?.length) return assignments;

    // The department is a property of the subject, not of the assignment, so
    // narrowing by it means resolving the subjects first.
    const wanted = new Set(subjectGroupIds);
    const subjects = await this.subjectModel
      .find({ _id: { $in: assignments.map((a) => a.subjectId) } })
      .select('subjectGroupId')
      .lean()
      .exec();
    const groupBySubject = new Map(
      subjects.map((subject) => [
        subject._id.toString(),
        subject.subjectGroupId ? subject.subjectGroupId.toString() : null,
      ]),
    );

    return assignments.filter((assignment) => {
      const group = groupBySubject.get(assignment.subjectId.toString());
      return group !== null && group !== undefined && wanted.has(group);
    });
  }

  private async notifyTeachers(
    month: LessonPlanMonthDocument,
    tasks: { teacherId: Types.ObjectId }[],
  ): Promise<void> {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const key = task.teacherId.toString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const [teacherId, count] of counts) {
      const userId = await this.notifications.findUserIdForPerson(
        'teacher',
        new Types.ObjectId(teacherId),
      );
      if (!userId) continue;

      await this.notifications.notifyMany([userId], {
        type: 'general',
        titleLo: 'ລາຍການແຜນການສອນເດືອນໃໝ່',
        titleEn: 'New monthly lesson-plan checklist',
        bodyLo: `ທ່ານມີ ${count} ແຜນການສອນທີ່ຕ້ອງສົ່ງໃນເດືອນ ${month.month}/${month.year}`,
        bodyEn: `You have ${count} lesson plans to hand in for ${month.month}/${month.year}`,
        data: { entityType: 'lessonPlanMonths', entityId: month._id.toString() },
      });
    }
  }

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

  private async findMonthOrFail(
    id: string,
    options: { includeDrafts?: boolean } = {},
  ): Promise<LessonPlanMonthDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const filter: Record<string, unknown> = { _id: id, deletedAt: null };
    if (options.includeDrafts === false) filter.status = 'published';

    const month = await this.monthModel.findOne(filter).exec();
    if (!month) throw AppException.notFound();
    return month;
  }

  private async findTaskOrFail(id: string): Promise<LessonPlanTaskDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const task = await this.taskModel.findOne({ _id: id, deletedAt: null }).exec();
    if (!task) throw AppException.notFound();
    return task;
  }

  /** Whether the caller runs the list rather than answers it. */
  private canManage(actor: AuthenticatedUser): boolean {
    return actor.permissions.some(
      (permission) =>
        permission.resource === 'lesson-plans' &&
        (permission.actions.includes('approve') || permission.actions.includes('manage')),
    );
  }

  private callerTeacherId(actor: AuthenticatedUser): Types.ObjectId | null {
    if (actor.personType !== 'teacher' || !actor.personId) return null;
    return new Types.ObjectId(actor.personId);
  }

  private lineKey(assignmentId: Types.ObjectId, weekStartDate: Date): string {
    return `${assignmentId.toString()}|${weekStartDate.toISOString().slice(0, 10)}`;
  }

  private planKey(
    teacherId: Types.ObjectId,
    subjectId: Types.ObjectId,
    classroomId: Types.ObjectId,
    weekStartDate: Date,
  ): string {
    return [
      teacherId.toString(),
      subjectId.toString(),
      classroomId.toString(),
      weekStartDate.toISOString().slice(0, 10),
    ].join('|');
  }
}

/** `dd/MM`, for a week span inside a generated title. */
function format(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}
