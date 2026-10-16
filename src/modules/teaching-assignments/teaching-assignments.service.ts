import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import type { MessageKey } from 'src/common/i18n/messages';
import {
  SchedulePeriod,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import { SubjectsService } from '../subjects/subjects.service';
import { TeachersService } from '../teachers/teachers.service';
import {
  CreateTeachingAssignmentDto,
  QueryTeachingAssignmentsDto,
  UpdateTeachingAssignmentDto,
} from './dto/teaching-assignment.dto';
import { openingHistory } from './opening-history';
import { ConflictKind, findScheduleConflicts, findSelfOverlaps } from './schedule-conflict';

/**
 * A classroom, carrying its grade code.
 *
 * A section name is only unique within its grade — every level has an "A" — so
 * a teacher who takes m3 A, m4 A and m5 A would otherwise read as three
 * identical rows in the assignment list and three identical cells in their
 * timetable. The nested populate is what makes those tell apart.
 */
const CLASSROOM_WITH_GRADE = {
  path: 'classroomId',
  select: 'name gradeLevelId',
  populate: { path: 'gradeLevelId', select: 'code nameLo nameEn' },
} as const;

const CONFLICT_MESSAGE: Record<ConflictKind, MessageKey> = {
  teacher: 'assignment.teacherConflict',
  classroom: 'assignment.classroomConflict',
  room: 'assignment.roomConflict',
};

/**
 * When the school teaches, if no setting says otherwise.
 *
 * Deliberately permissive: a missing setting must not lock a school out of its
 * own timetable. The real window is seeded per school and edited from settings,
 * never hardcoded here.
 */
const DEFAULT_SCHOOL_DAY = {
  startTime: '00:00',
  endTime: '23:59',
  /** 0 = Sunday … 6 = Saturday, matching `SchedulePeriod.dayOfWeek`. */
  days: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * A calendar date, collapsed to the UTC midnight every school day is stored at.
 *
 * Local here rather than imported from the roll call: this module is upstream of
 * it, and an import the other way would be a module edge for four lines.
 */
function toUtcMidnight(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

@Injectable()
export class TeachingAssignmentsService extends BaseCrudService<TeachingAssignmentDocument> {
  protected readonly entityType = 'teachingAssignments';
  protected readonly sortableFields = ['createdAt'] as const;

  constructor(
    @InjectModel(TeachingAssignment.name) model: Model<TeachingAssignmentDocument>,
    audit: AuditLogsService,
    private readonly teachers: TeachersService,
    private readonly subjects: SubjectsService,
    private readonly classrooms: ClassroomsService,
    private readonly semesters: SemestersService,
    private readonly settings: SettingsService,
  ) {
    super(model, audit);
  }

  async findAll(
    query: QueryTeachingAssignmentsDto,
  ): Promise<PaginatedResponse<TeachingAssignmentDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.isActive !== undefined) filter.isActive = query.isActive;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('teacherId', 'teacherCode firstNameLo lastNameLo')
        .populate('subjectId', 'code nameLo nameEn credits')
        .populate(CLASSROOM_WITH_GRADE)
        .sort({ createdAt: -1 })
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

  /** A teacher's timetable for a semester. */
  async findTeacherSchedule(teacherId: string, semesterId: string) {
    return this.model
      .find({
        teacherId: new Types.ObjectId(teacherId),
        semesterId: new Types.ObjectId(semesterId),
        isActive: true,
        deletedAt: null,
      })
      .populate('subjectId', 'code nameLo')
      .populate(CLASSROOM_WITH_GRADE)
      .exec();
  }

  /** A classroom's timetable for a semester. */
  async findClassroomSchedule(classroomId: string, semesterId: string) {
    return this.model
      .find({
        classroomId: new Types.ObjectId(classroomId),
        semesterId: new Types.ObjectId(semesterId),
        isActive: true,
        deletedAt: null,
      })
      .populate('subjectId', 'code nameLo')
      .populate('teacherId', 'teacherCode firstNameLo lastNameLo')
      .exec();
  }

  /**
   * Is this user the assigned teacher for a subject in a classroom?
   *
   * The authorization check behind score entry — only the teacher who actually
   * teaches a class may grade it.
   */
  async isAssignedTeacher(
    teacherId: string,
    subjectId: string | Types.ObjectId,
    classroomId: string | Types.ObjectId,
    semesterId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(teacherId)) return false;
    const exists = await this.model
      .exists({
        teacherId: new Types.ObjectId(teacherId),
        subjectId,
        classroomId,
        semesterId,
        isActive: true,
        deletedAt: null,
      })
      .session(session ?? null)
      .exec();
    return exists !== null;
  }

  async create(dto: CreateTeachingAssignmentDto, context: CrudContext) {
    const classroom = await this.classrooms.findOneOrFail(dto.classroomId);
    const subject = await this.subjects.findOneOrFail(dto.subjectId);

    const [, semester] = await Promise.all([
      this.teachers.assertExists(dto.teacherId),
      this.semesters.getWritableOrFail(dto.semesterId),
    ]);

    // A subject belongs to a grade level; assigning it to a class of a different
    // level would let students be graded on a curriculum they are not taking.
    if (!subject.gradeLevelId.equals(classroom.gradeLevelId)) {
      throw AppException.badRequest('assignment.subjectGradeMismatch', {
        subjectGradeLevelId: subject.gradeLevelId.toString(),
        classroomGradeLevelId: classroom.gradeLevelId.toString(),
      });
    }

    await this.assertNotAlreadyAssigned(dto);
    await this.assertValidSchedule(dto.schedule);
    await this.assertNoConflict(
      { teacherId: dto.teacherId, classroomId: dto.classroomId, schedule: dto.schedule },
      dto.semesterId,
    );

    return this.createDocument(
      {
        teacherId: new Types.ObjectId(dto.teacherId),
        subjectId: new Types.ObjectId(dto.subjectId),
        classroomId: new Types.ObjectId(dto.classroomId),
        semesterId: new Types.ObjectId(dto.semesterId),
        schoolYearId: classroom.schoolYearId,
        schedule: dto.schedule,
        // Started mid-term: nothing is owed before the day it starts.
        scheduleHistory: dto.effectiveFrom
          ? openingHistory({
              termStart: semester.startDate,
              startsOn: dto.effectiveFrom,
              schedule: dto.schedule,
              changedBy: context.actor?.sub ? new Types.ObjectId(context.actor.sub) : null,
            })
          : [],
        notes: dto.notes ?? null,
      } as Partial<TeachingAssignmentDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateTeachingAssignmentDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);
    const { effectiveFrom, scheduleNote, ...rest } = dto;

    if (!dto.schedule) return this.updateDocument(id, rest, context);

    await this.assertValidSchedule(dto.schedule);
    // Checked against what the other lessons say *now*, which is what "from now
    // on" means: a clash in a week that has already been taught is a fact about
    // the past, and refusing a revision over it would leave the timetable unable
    // to be corrected at all.
    await this.assertNoConflict(
      {
        teacherId: current.teacherId.toString(),
        classroomId: current.classroomId.toString(),
        schedule: dto.schedule,
      },
      current.semesterId.toString(),
      id,
    );

    return this.replaceSchedule(current, dto.schedule, context, {
      effectiveFrom,
      note: scheduleNote,
      rest,
    });
  }

  /**
   * Moves a lesson, and records the days its old arrangement applied to.
   *
   * The only writer of `schedule` and of `scheduleHistory`, which is what keeps
   * the field and the list from disagreeing — see the field's own note.
   *
   * The new arrangement owns `[effectiveFrom, ∞)`, so the spells are rebuilt
   * rather than appended to: anything starting on or after that day described days
   * the new one now claims, and leaving it in place would shadow the change —
   * `slotsOn` takes the first spell that matches, so an older entry would keep
   * answering for days the office has just said belong to the new timetable. A
   * spell straddling the day is truncated to it, and spells wholly before it are
   * left alone.
   *
   * The spell that closes the *first* revision starts at the start of term, not at
   * the lesson's own `createdAt`: the reports owe a lesson from the window they are
   * asked for rather than from the day somebody keyed the row in, and offices enter
   * timetables late. That also gives the correction case a meaning worth having —
   * an `effectiveFrom` at or before the start of term closes nothing, because there
   * is no "before", which is exactly what "this is what the timetable always should
   * have said" means.
   */
  private async replaceSchedule(
    current: TeachingAssignmentDocument,
    schedule: SchedulePeriod[],
    context: CrudContext,
    options: {
      effectiveFrom?: string;
      note?: string;
      rest: Omit<UpdateTeachingAssignmentDto, 'schedule' | 'effectiveFrom' | 'scheduleNote'> & {
        schedule?: SchedulePeriod[];
      };
    },
  ) {
    const from = toUtcMidnight(options.effectiveFrom ?? new Date());
    const changedBy = context.actor?.sub ? new Types.ObjectId(context.actor.sub) : null;
    const note = options.note?.trim() || null;

    const kept = current.scheduleHistory
      .filter((spell) => spell.from < from)
      .map((spell) => ({
        schedule: spell.schedule,
        from: spell.from,
        to: spell.to === null || spell.to === undefined || spell.to > from ? from : spell.to,
        changedBy: spell.changedBy ?? null,
        note: spell.note ?? null,
      }));

    // Nothing recorded yet: the arrangement being replaced is the current one, and
    // it has applied for as long as anything asks — since the start of term.
    if (current.scheduleHistory.length === 0) {
      const term = await this.semesters.findOne(current.semesterId.toString()).catch(() => null);
      const openedAt = toUtcMidnight(term?.startDate ?? current.createdAt ?? from);
      if (openedAt < from) {
        kept.push({ schedule: current.schedule, from: openedAt, to: from, changedBy, note });
      }
    }

    await this.model
      .updateOne(
        { _id: current._id, deletedAt: null },
        { $set: { scheduleHistory: [...kept, { schedule, from, to: null, changedBy, note }] } },
        { session: context.session },
      )
      .exec();

    return this.updateDocument(current._id.toString(), { ...options.rest, schedule }, context);
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Refuses a second assignment for a pairing that already has one.
   *
   * One assignment holds *all* the weekly periods for a teacher/subject/class,
   * which is what the unique index enforces. So a teacher who takes maths with
   * ມ.2/ກ on Monday and again on Friday has one assignment with two periods —
   * not two assignments.
   *
   * The index would catch it anyway, but only as `common.duplicate`: "this
   * already exists", with nothing about what to do instead. Since a timetable is
   * entered day by day, that dead end is on the most common path there is, so
   * the check is made here where it can name the record to go and add the
   * period to.
   */
  private async assertNotAlreadyAssigned(dto: CreateTeachingAssignmentDto): Promise<void> {
    const existing = await this.model
      .findOne({
        teacherId: new Types.ObjectId(dto.teacherId),
        subjectId: new Types.ObjectId(dto.subjectId),
        classroomId: new Types.ObjectId(dto.classroomId),
        semesterId: new Types.ObjectId(dto.semesterId),
        deletedAt: null,
      })
      .select('_id')
      .lean()
      .exec();

    if (existing) {
      throw AppException.conflict('assignment.alreadyAssigned', {
        assignmentId: existing._id.toString(),
      });
    }
  }

  private async assertValidSchedule(schedule: SchedulePeriod[]): Promise<void> {
    for (const period of schedule) {
      if (period.startTime >= period.endTime) {
        throw AppException.badRequest('assignment.invalidTimeRange', {
          startTime: period.startTime,
          endTime: period.endTime,
        });
      }
    }

    const selfOverlaps = findSelfOverlaps(schedule);
    if (selfOverlaps.length > 0) {
      throw AppException.badRequest('assignment.invalidTimeRange', {
        reason: 'the requested schedule overlaps itself',
        overlappingIndexes: selfOverlaps,
      });
    }

    await this.assertWithinSchoolDay(schedule);
  }

  /**
   * Keeps the timetable inside the hours the school actually opens.
   *
   * Without this the only limits on a period are `start < end` and not clashing
   * with another lesson, so a typo puts a class at 08:00 in a school that only
   * teaches in the afternoon — and nothing downstream would question it, since
   * attendance takes its period straight from the timetable.
   *
   * Zero-padded `HH:mm` compares lexicographically in chronological order, the
   * same property `periodsOverlap` relies on, so no parsing is needed.
   */
  private async assertWithinSchoolDay(schedule: SchedulePeriod[]): Promise<void> {
    const [startTime, endTime, days] = await Promise.all([
      this.settings.getValue<string>('schedule.dayStartTime'),
      this.settings.getValue<string>('schedule.dayEndTime'),
      this.settings.getValue<number[]>('schedule.teachingDays'),
    ]);

    const window = {
      startTime: startTime ?? DEFAULT_SCHOOL_DAY.startTime,
      endTime: endTime ?? DEFAULT_SCHOOL_DAY.endTime,
      days: days ?? DEFAULT_SCHOOL_DAY.days,
    };

    for (const period of schedule) {
      if (period.startTime < window.startTime || period.endTime > window.endTime) {
        throw AppException.badRequest('assignment.outsideSchoolDay', {
          startTime: period.startTime,
          endTime: period.endTime,
          schoolDay: [window.startTime, window.endTime],
        });
      }

      if (!window.days.includes(period.dayOfWeek)) {
        throw AppException.badRequest('assignment.notATeachingDay', {
          dayOfWeek: period.dayOfWeek,
          teachingDays: window.days,
        });
      }
    }
  }

  /**
   * Rejects a schedule that clashes with anything already assigned this semester.
   *
   * Loads every active assignment for the semester that involves either the same
   * teacher or the same classroom — the two indexed access paths — plus anything
   * using a room the request wants. Comparison itself is pure and unit-tested in
   * schedule-conflict.spec.ts.
   */
  private async assertNoConflict(
    requested: { teacherId: string; classroomId: string; schedule: SchedulePeriod[] },
    semesterId: string,
    excludeAssignmentId?: string,
  ): Promise<void> {
    const requestedRooms = requested.schedule
      .map((p) => p.room)
      .filter((room): room is string => Boolean(room));

    const candidates = await this.model
      .find({
        semesterId: new Types.ObjectId(semesterId),
        isActive: true,
        deletedAt: null,
        ...(excludeAssignmentId ? { _id: { $ne: new Types.ObjectId(excludeAssignmentId) } } : {}),
        $or: [
          { teacherId: new Types.ObjectId(requested.teacherId) },
          { classroomId: new Types.ObjectId(requested.classroomId) },
          ...(requestedRooms.length > 0 ? [{ 'schedule.room': { $in: requestedRooms } }] : []),
        ],
      })
      .select('teacherId classroomId schedule')
      .lean()
      .exec();

    const conflicts = findScheduleConflicts(
      requested,
      candidates.map((c) => ({
        id: c._id.toString(),
        teacherId: c.teacherId.toString(),
        classroomId: c.classroomId.toString(),
        schedule: c.schedule,
      })),
    );

    if (conflicts.length > 0) {
      // A swap marked on one side only is not really a double-booking, and
      // saying it is sends the user hunting for a clash that is not there. When
      // that is the whole of the problem, the refusal names the actual fix:
      // mark the lesson on the other side too.
      if (conflicts.every((conflict) => conflict.rotationMismatch)) {
        throw AppException.conflict('assignment.rotationNotMarked', { conflicts });
      }

      // Report the most specific problem first: a double-booked teacher is a
      // harder constraint than a shared room.
      const priority: ConflictKind[] = ['teacher', 'classroom', 'room'];
      const primary = priority.map((kind) => conflicts.find((c) => c.kind === kind)).find(Boolean)!;

      throw AppException.conflict(CONFLICT_MESSAGE[primary.kind], { conflicts });
    }
  }
}
